import { accountAuth, accountFrom, cloudbaseEnvironment } from './cloudbaseAccount'
import { MATCH_HISTORY_LIMIT, isHistoryId, normalizeHistorySnapshot, validateHistoryRecord, validateHistorySummary, type HistoryRecord, type HistorySummary, type SaveHistoryInput } from './matchHistory'

const summaryFields = 'user_id,id,title,created_at,updated_at,version'
const fullFields = summaryFields + ',original_snapshot,current_snapshot'
const base = `https://${cloudbaseEnvironment}.api.tcloudbasegateway.com/v1/rdb/rest/`

async function request(accountId: string, path: string, signal: AbortSignal, body?: unknown): Promise<unknown[]> {
  const result = await accountAuth.getSession(); const session = result.data.session
  if (result.error || accountFrom(session?.user)?.id !== accountId || !session?.access_token) throw new Error('登录状态已变化，请重新登录后调阅历史。')
  signal.throwIfAborted()
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => { signal.throwIfAborted(); throw new Error('历史记录暂时无法连接云端，请重试；当前简历仍保留。') })
  if (response.status === 401) throw new Error('登录已过期，请重新登录后调阅历史。')
  if (response.status === 409) throw new Error('历史记录已在其他设备修改，或已超出 30 条保留范围。请重新调阅后再修改；本次未覆盖云端。')
  if (response.status === 403 || response.status === 404) throw new Error('历史记录服务尚未准备好，请先执行 005_match_history.sql，再重试。')
  if (!response.ok) throw new Error(`历史记录${body === undefined ? '读取' : '保存'}失败（HTTP ${response.status}），当前简历仍保留。`)
  const rows: unknown = await response.json()
  if (!Array.isArray(rows) || rows.length > MATCH_HISTORY_LIMIT) throw new Error('历史记录返回格式异常，已停止显示。')
  return rows
}

function checkedRow(value: unknown, accountId: string, full = false): HistorySummary | HistoryRecord {
  if (!value || typeof value !== 'object') throw new Error('历史记录返回格式异常。')
  const row = value as Record<string, unknown>
  if (row.user_id !== accountId) throw new Error('历史记录归属校验失败，已停止显示。')
  const converted = { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
    original: row.original_snapshot, current: row.current_snapshot }
  return full ? validateHistoryRecord(converted) : validateHistorySummary(converted)
}

export async function listMatchHistory(accountId: string, signal: AbortSignal): Promise<HistorySummary[]> {
  const params = new URLSearchParams({ select: summaryFields, user_id: `eq.${accountId}`, order: 'created_at.desc,id.desc', limit: String(MATCH_HISTORY_LIMIT) })
  const rows = await request(accountId, `jobsense_match_history?${params}`, signal)
  const result = rows.map((row) => checkedRow(row, accountId))
  if (new Set(result.map((row) => row.id)).size !== result.length) throw new Error('历史记录编号重复。')
  return result
}

export async function loadMatchHistory(accountId: string, id: string, signal: AbortSignal): Promise<HistoryRecord> {
  if (!isHistoryId(id)) throw new Error('历史记录编号不受支持。')
  const params = new URLSearchParams({ select: fullFields, user_id: `eq.${accountId}`, id: `eq.${id}`, limit: '2' })
  const rows = await request(accountId, `jobsense_match_history?${params}`, signal)
  if (rows.length !== 1) throw new Error('这条历史已不在保留范围内，请刷新历史列表。')
  const row = checkedRow(rows[0], accountId, true) as HistoryRecord
  if (row.id !== id) throw new Error('历史记录编号校验失败。')
  return row
}

export async function saveMatchHistory(accountId: string, input: SaveHistoryInput, signal: AbortSignal): Promise<HistoryRecord> {
  if (!isHistoryId(input.id) || typeof input.title !== 'string' || !input.title.trim() || Array.from(input.title).length > 120
    || /[\u0000-\u001f\u007f]/u.test(input.title) || (input.expectedVersion !== null && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1))) throw new Error('历史保存参数不受支持。')
  const snapshot = normalizeHistorySnapshot(input.snapshot)
  const rows = await request(accountId, 'rpc/jobsense_save_match_history', signal, {
    p_id: input.id, p_title: input.title.trim(), p_snapshot: snapshot, p_expected_version: input.expectedVersion,
  })
  if (rows.length !== 1) throw new Error('云端没有确认历史保存，请重试。')
  const saved = checkedRow(rows[0], accountId, true) as HistoryRecord
  if (saved.id !== input.id || saved.title !== input.title.trim()
    || (input.expectedVersion !== null && saved.version < input.expectedVersion)) throw new Error('历史保存结果校验失败。')
  // PostgreSQL jsonb reorders object keys, so compare canonical values rather than insertion order.
  if (canonical(saved.current) !== canonical(snapshot)) throw new Error('历史保存内容校验失败，请重新读取。')
  return saved
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
