import { accountAuth, accountFrom, cloudbaseEnvironment } from './cloudbaseAccount'
import { fieldLimits, experienceTypes, normalizeInput, type ArchiveCommand, type ArchiveSnapshot } from './experienceArchive'
import type { Experience, ExperienceInput } from './types'

const fields = 'user_id,id,title,type,period,location,organization,role,summary,outcome,skills,version,created_at,updated_at,deleted_at'

interface CloudExperience {
  user_id: string; id: string; title: string; type: string; period: string; location: string
  organization: string; role: string; summary: string; outcome: string; skills: string[]
  version: number; created_at: string; updated_at: string; deleted_at: string | null
}

export interface ImportResult { added: number; skipped: number }

function checkedRow(value: unknown, accountId: string): Experience {
  if (!value || typeof value !== 'object') throw new Error('云端经历格式异常，未显示数据。')
  const row = value as CloudExperience
  if (row.user_id !== accountId || typeof row.id !== 'string' || !row.id || row.id.length > 100 ||
    typeof row.title !== 'string' || row.title.length > fieldLimits.title || !row.title.trim() ||
    !experienceTypes.includes(row.type as Experience['type']) || typeof row.period !== 'string' || row.period.length > fieldLimits.period ||
    typeof row.location !== 'string' || row.location.length > fieldLimits.location ||
    typeof row.organization !== 'string' || row.organization.length > fieldLimits.organization ||
    typeof row.role !== 'string' || row.role.length > fieldLimits.role ||
    typeof row.summary !== 'string' || row.summary.length > fieldLimits.summary ||
    typeof row.outcome !== 'string' || row.outcome.length > fieldLimits.outcome ||
    !Array.isArray(row.skills) || row.skills.length > 30 || row.skills.some((skill) => typeof skill !== 'string' || skill.length > 60) ||
    !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.created_at)) ||
    !Number.isFinite(Date.parse(row.updated_at)) || (row.deleted_at !== null && !Number.isFinite(Date.parse(row.deleted_at))) ||
    (row.type !== '教育' && !row.summary.trim())) throw new Error('云端经历字段校验失败，已停止读取。')
  return { id: row.id, title: row.title, type: row.type as Experience['type'], period: row.period, location: row.location,
    organization: row.organization, role: row.role, summary: row.summary, outcome: row.outcome, skills: row.skills,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at }
}

async function sessionFor(accountId?: string) {
  const result = await accountAuth.getSession()
  const session = result.data.session
  const account = accountFrom(session?.user)
  if (result.error || !session?.access_token || !account || (accountId && account.id !== accountId)) {
    throw new Error('登录状态已变化，请重新登录后再操作。')
  }
  return { account, token: session.access_token }
}

export async function currentCloudAccountId() { return (await sessionFor()).account.id }

async function request(accountId: string, path: URLSearchParams, method: 'GET' | 'POST' | 'PATCH', body?: unknown, signal?: AbortSignal) {
  const { account, token } = await sessionFor(accountId)
  const url = `https://${cloudbaseEnvironment}.api.tcloudbasegateway.com/v1/rdb/rest/jobsense_experiences?${path}`
  const response = await fetch(url, { method, credentials: 'omit', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Prefer: 'return=representation' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).catch((error: unknown) => {
      signal?.throwIfAborted()
      throw error instanceof Error && error.name === 'TimeoutError'
        ? new Error('云端请求超时；请重试，原本机资料未受影响。')
        : new Error('暂时无法连接云端经历库，请检查网络后重试。')
    })
  if (response.status === 401) throw new Error('登录已过期，请重新登录。')
  if (response.status === 409) throw new Error('这段经历已存在或刚被更新。请重新读取后再操作。')
  if (!response.ok) throw new Error('云端经历库暂时无法完成操作，请检查 CloudBase 数据库权限配置。')
  if (method === 'PATCH' && response.status === 204) return { account, rows: [] as unknown[] }
  const payload: unknown = await response.json().catch(() => { throw new Error('云端经历库返回格式异常，未显示或覆盖资料。') })
  if (!Array.isArray(payload)) throw new Error('云端经历库返回格式异常，未显示或覆盖资料。')
  return { account, rows: payload }
}

function query(accountId: string) {
  const params = new URLSearchParams({ select: fields, user_id: `eq.${accountId}`, order: 'updated_at.desc', limit: '500' })
  return params
}

function insertQuery() { return new URLSearchParams({ select: fields }) }

export async function loadCloudArchive(accountId: string, signal?: AbortSignal): Promise<ArchiveSnapshot> {
  const { account, rows } = await request(accountId, query(accountId), 'GET', undefined, signal)
  const entries = rows.map((row) => checkedRow(row, account.id))
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('云端经历编号重复，已停止显示。')
  return { schemaVersion: 1, revision: entries.length, entries }
}

function rowBody(id: string, input: ExperienceInput, createdAt: string, updatedAt: string, deletedAt: string | null) {
  const clean = normalizeInput(input)
  return { id, ...clean, created_at: createdAt, updated_at: updatedAt, deleted_at: deletedAt }
}

export async function performCloudArchiveCommand(accountId: string, snapshot: ArchiveSnapshot, command: ArchiveCommand): Promise<ArchiveSnapshot> {
  const { account } = await sessionFor(accountId)
  if (command.kind === 'create') {
    if (snapshot.entries.some((entry) => entry.id === command.id)) throw new Error('经历编号重复，请重新新建。')
    const now = new Date().toISOString()
    await request(account.id, insertQuery(), 'POST', rowBody(command.id, command.input, now, now, null))
  } else {
    const existing = snapshot.entries.find((entry) => entry.id === command.id)
    if (!existing || existing.updatedAt !== command.expectedUpdatedAt) throw new Error('这段经历已变化，请先重新读取最新资料。')
    if ((command.kind === 'restore') !== Boolean(existing.deletedAt)) throw new Error('经历状态已变化，请先重新读取。')
    const update = command.kind === 'update'
      ? { ...normalizeInput(command.input), deleted_at: existing.deletedAt }
      : { deleted_at: command.kind === 'trash' ? new Date().toISOString() : null }
    const params = new URLSearchParams({ id: `eq.${command.id}`, user_id: `eq.${account.id}`, updated_at: `eq.${existing.updatedAt}`, select: fields })
    const result = await request(account.id, params, 'PATCH', update)
    if (!result.rows.length) throw new Error('这段经历刚被其他设备修改，请重新读取后再操作。')
  }
  return loadCloudArchive(account.id)
}

export async function importCloudExperiences(accountId: string, entries: Experience[]): Promise<ImportResult> {
  const existing = await loadCloudArchive(accountId)
  const known = new Set(existing.entries.map((entry) => entry.id))
  let added = 0
  let skipped = 0
  for (const entry of entries) {
    if (known.has(entry.id)) { skipped++; continue }
    const input = normalizeInput(entry)
    try {
      await request(accountId, insertQuery(), 'POST', rowBody(entry.id, input, entry.createdAt, entry.updatedAt, entry.deletedAt))
      known.add(entry.id); added++
    } catch (cause) {
      // A retry after a lost response must not overwrite an already-imported row.
      if (cause instanceof Error && /已存在|刚被更新/u.test(cause.message)) { known.add(entry.id); skipped++; continue }
      throw new Error(`已导入 ${added} 条，跳过 ${skipped} 条后中断。原本机资料未删除；重新选择同一个文件可继续，已导入内容会自动跳过。`)
    }
  }
  return { added, skipped }
}
