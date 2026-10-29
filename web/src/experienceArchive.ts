import type { Experience, ExperienceInput, ExperienceType } from './types.ts'
import { demoExperiences } from './data.ts'

export const ARCHIVE_KEY = 'career-archive-experiences-v1'
export const experienceTypes: ExperienceType[] = ['教育', '科研', '项目', '实习', '实践']
export const fieldLimits = { title: 150, organization: 200, role: 120, period: 100, location: 100, summary: 10000, outcome: 10000 }

export interface ArchiveSnapshot {
  schemaVersion: 1
  revision: number
  entries: Experience[]
}

export interface ArchiveStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type ArchiveCommand =
  | { kind: 'create'; id: string; input: ExperienceInput }
  | { kind: 'update'; id: string; expectedUpdatedAt: string; input: ExperienceInput }
  | { kind: 'trash' | 'restore'; id: string; expectedUpdatedAt: string }

export class ArchiveError extends Error {
  code: 'storage' | 'format' | 'invalid' | 'conflict'
  constructor(code: ArchiveError['code'], message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validExperience(value: unknown): value is Experience {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id.trim()) return false
  for (const [key, max] of Object.entries(fieldLimits)) {
    if (key === 'location' && value.location === undefined) continue
    if (typeof value[key] !== 'string' || value[key].length > max) return false
  }
  return Boolean(
    (value.title as string).trim() && (value.type === '教育' || (value.summary as string).trim()) &&
    experienceTypes.includes(value.type as ExperienceType) &&
    Array.isArray(value.skills) && value.skills.length <= 30 &&
    value.skills.every((skill) => typeof skill === 'string' && skill.trim() && skill.length <= 60) &&
    isDate(value.createdAt) && isDate(value.updatedAt) &&
    (value.deletedAt === null || isDate(value.deletedAt)),
  )
}

export function readArchive(storage: ArchiveStorage): ArchiveSnapshot {
  let raw: string | null
  try {
    raw = storage.getItem(ARCHIVE_KEY)
  } catch {
    throw new ArchiveError('storage', '无法读取本机资料。请允许浏览器保存网站数据，再点击“重新读取”。')
  }
  // Only a missing key gets samples. An existing empty archive must stay empty.
  if (raw === null) return { schemaVersion: 1, revision: 0, entries: structuredClone(demoExperiences) }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ArchiveError('format', '本机资料无法解析，已停止写入并保留原数据。请联系开发者处理。')
  }
  if (!isObject(parsed) || parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) ||
      (parsed.revision as number) < 0 || !Array.isArray(parsed.entries) || !parsed.entries.every(validExperience) ||
      new Set(parsed.entries.map((entry) => entry.id)).size !== parsed.entries.length) {
    throw new ArchiveError('format', '本机资料格式或版本不受支持，已停止写入并保留原数据。请联系开发者处理。')
  }
  return parsed as unknown as ArchiveSnapshot
}

export function normalizeInput(input: ExperienceInput): ExperienceInput {
  const clean = {
    title: input.title.trim(),
    type: input.type,
    period: input.period.trim(),
    location: input.location?.trim() ?? '',
    organization: input.organization.trim(),
    role: input.role.trim(),
    summary: input.summary.trim(),
    outcome: input.outcome.trim(),
    skills: [...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))],
  }
  if (!clean.title || (clean.type !== '教育' && !clean.summary)) {
    throw new ArchiveError('invalid', clean.type === '教育' ? '请填写学校名称。' : '请填写经历名称和具体贡献，内容不能只有空格。')
  }
  if (!experienceTypes.includes(clean.type)) throw new ArchiveError('invalid', '请选择支持的经历类型。')
  for (const [key, max] of Object.entries(fieldLimits)) {
    if (clean[key as keyof typeof fieldLimits].length > max) throw new ArchiveError('invalid', '填写内容过长，请精简后再保存。')
  }
  if (clean.skills.length > 30 || clean.skills.some((skill) => skill.length > 60)) {
    throw new ArchiveError('invalid', '最多填写 30 个技能关键词，每个不超过 60 字。')
  }
  return clean
}

export function applyArchiveCommand(storage: ArchiveStorage, command: ArchiveCommand, now = new Date().toISOString()): ArchiveSnapshot {
  const current = readArchive(storage)
  if (!isDate(now)) throw new ArchiveError('invalid', '保存时间无效，请重新尝试。')
  let entries: Experience[]
  if (command.kind === 'create') {
    if (!command.id.trim() || current.entries.some((entry) => entry.id === command.id)) {
      throw new ArchiveError('conflict', '资料编号重复，请重新尝试新建。')
    }
    entries = [{ ...normalizeInput(command.input), id: command.id, createdAt: now, updatedAt: now, deletedAt: null }, ...current.entries]
  } else {
    const item = current.entries.find((entry) => entry.id === command.id)
    if (!item || item.updatedAt !== command.expectedUpdatedAt) {
      throw new ArchiveError('conflict', '这段经历已在其他页面发生变化。请重新打开最新内容后操作；当前填写的文字仍保留。')
    }
    if ((command.kind === 'restore') !== Boolean(item.deletedAt)) {
      throw new ArchiveError('conflict', '这段经历的状态已变化，请重新查看列表。')
    }
    const updatedAt = new Date(Math.max(Date.parse(now), Date.parse(item.updatedAt) + 1)).toISOString()
    entries = current.entries.map((entry) => {
      if (entry.id !== item.id) return entry
      if (command.kind === 'update') return { ...entry, ...normalizeInput(command.input), updatedAt }
      return { ...entry, updatedAt, deletedAt: command.kind === 'trash' ? updatedAt : null }
    })
  }
  const next: ArchiveSnapshot = { ...current, revision: current.revision + 1, entries }
  try {
    storage.setItem(ARCHIVE_KEY, JSON.stringify(next))
  } catch {
    throw new ArchiveError('storage', '本次保存失败，可能是浏览器存储空间不足或禁止保存。原资料未改动，请保留当前文字后重试。')
  }
  return next
}

export function searchExperiences(entries: Experience[], query: string, type = '全部', deleted = false): Experience[] {
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase()
  const terms = normalize(query.trim()).split(/\s+/u).filter(Boolean)
  return entries.filter((item) => {
    const searchable = normalize([item.title, item.summary, item.outcome, item.organization, item.role, item.period, item.location ?? '', item.type, ...item.skills].join(' '))
    return Boolean(item.deletedAt) === deleted && (type === '全部' || item.type === type) &&
      terms.every((term) => searchable.includes(term))
  }).sort((a, b) => (deleted ? b.deletedAt! : b.updatedAt).localeCompare(deleted ? a.deletedAt! : a.updatedAt))
}
