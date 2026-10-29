export const applicationTypes = ['实习', '校招', '社招', '全职', '兼职', '其他'] as const
export const applicationStages = ['已投递', '简历筛选', '笔试', '一面', '二面', '终面', 'Offer', '未通过', '已撤回'] as const
export const APPLICATION_RECORDS_KEY = 'career-archive-applications-v1'
const recordLimit = 10000

export type ApplicationType = typeof applicationTypes[number]
export type ApplicationStage = typeof applicationStages[number]

export interface ApplicationRecord {
  id: string
  company: string
  position: string
  type: string
  stage: ApplicationStage
  appliedDate: string
  createdAt: string
  updatedAt: string
}

export interface ApplicationInput {
  company: string
  position: string
  type: string
  stage: ApplicationStage
  appliedDate: string
}

export interface ApplicationSnapshot {
  schemaVersion: 1
  revision: string
  records: ApplicationRecord[]
}

export interface ApplicationAiSummary {
  total: number
  byType: { type: ApplicationType; count: number }[]
  byStage: { stage: ApplicationStage; count: number }[]
  byMonth: { month: string; count: number }[]
}

export interface ApplicationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class ApplicationRecordError extends Error {
  code: 'storage' | 'format' | 'invalid' | 'conflict'
  constructor(code: ApplicationRecordError['code'], message: string) {
    super(message)
    this.name = 'ApplicationRecordError'
    this.code = code
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function dateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 10) === value
}

function validRecord(value: unknown): value is ApplicationRecord {
  return object(value) && typeof value.id === 'string' && !!value.id.trim() && value.id.length <= 100
    && typeof value.company === 'string' && !!value.company.trim() && value.company.length <= 150
    && typeof value.position === 'string' && !!value.position.trim() && value.position.length <= 150
    && typeof value.type === 'string' && !!value.type.trim() && value.type.length <= 40
    && applicationStages.includes(value.stage as ApplicationStage)
    && dateOnly(value.appliedDate)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
}

export function readApplicationRecords(storage: ApplicationStorage): ApplicationSnapshot {
  let raw: string | null
  try { raw = storage.getItem(APPLICATION_RECORDS_KEY) }
  catch { throw new ApplicationRecordError('storage', '无法读取投递记录，请检查浏览器本机存储设置。') }
  if (raw === null) return { schemaVersion: 1, revision: '', records: [] }
  let value: unknown
  try { value = JSON.parse(raw) }
  catch { throw new ApplicationRecordError('format', '投递记录格式无法解析；原数据已保留，已暂停保存。') }
  if (!object(value) || value.schemaVersion !== 1 || typeof value.revision !== 'string' || !Array.isArray(value.records)
    || value.records.length > recordLimit || !value.records.every(validRecord)
    || new Set(value.records.map((item) => (item as ApplicationRecord).id)).size !== value.records.length) {
    throw new ApplicationRecordError('format', '投递记录版本或内容不受支持；原数据已保留，已暂停保存。')
  }
  return value as unknown as ApplicationSnapshot
}

export function normalizeApplicationInput(input: ApplicationInput): ApplicationInput {
  const clean = { company: input.company.trim(), position: input.position.trim(), type: input.type.trim(), stage: input.stage, appliedDate: input.appliedDate }
  if (!clean.company || !clean.position || !clean.type || !dateOnly(clean.appliedDate) || !applicationStages.includes(clean.stage)) {
    throw new ApplicationRecordError('invalid', '请填写公司、职位、职位类型，并选择有效的投递日期和进度。')
  }
  if (clean.company.length > 150 || clean.position.length > 150 || clean.type.length > 40) {
    throw new ApplicationRecordError('invalid', '公司、职位或职位类型内容过长，请精简后重试。')
  }
  return clean
}

export function applyApplicationMutation(storage: ApplicationStorage, expectedRevision: string,
  command: { kind: 'save'; id?: string; expectedUpdatedAt?: string; input: ApplicationInput } | { kind: 'delete'; id: string }) {
  const current = readApplicationRecords(storage)
  if (current.revision !== expectedRevision) throw new ApplicationRecordError('conflict', '投递记录已在其他页面更新，请重新读取后再操作。')
  const now = new Date().toISOString()
  let records: ApplicationRecord[]
  if (command.kind === 'delete') {
    if (!current.records.some((item) => item.id === command.id)) throw new ApplicationRecordError('conflict', '这条记录已变化或被删除，请重新读取。')
    records = current.records.filter((item) => item.id !== command.id)
  } else {
    const input = normalizeApplicationInput(command.input)
    if (command.id) {
      const existing = current.records.find((item) => item.id === command.id)
      if (!existing || existing.updatedAt !== command.expectedUpdatedAt) throw new ApplicationRecordError('conflict', '这条记录已在其他页面更新，请重新读取后再编辑。')
      records = current.records.map((item) => item.id === command.id ? { ...existing, ...input, updatedAt: now } : item)
    } else {
      if (current.records.length >= recordLimit) throw new ApplicationRecordError('invalid', '已达到本机投递记录上限。')
      records = [{ ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }, ...current.records]
    }
  }
  const next: ApplicationSnapshot = { schemaVersion: 1, revision: crypto.randomUUID(), records }
  try { storage.setItem(APPLICATION_RECORDS_KEY, JSON.stringify(next)) }
  catch { throw new ApplicationRecordError('storage', '本次未能保存投递记录，请检查浏览器存储空间。原记录仍保留。') }
  return next
}

export function localDateValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function makeApplicationAiSummary(records: ApplicationRecord[], now = new Date()): ApplicationAiSummary {
  const typeCounts = new Map<ApplicationType, number>(applicationTypes.map((type) => [type, 0]))
  const stageCounts = new Map<ApplicationStage, number>(applicationStages.map((stage) => [stage, 0]))
  const monthCounts = new Map<string, number>()
  for (const record of records) {
    const knownType = applicationTypes.find((type) => type !== '其他' && type.toLocaleLowerCase() === record.type.trim().toLocaleLowerCase()) ?? '其他'
    typeCounts.set(knownType, (typeCounts.get(knownType) ?? 0) + 1)
    stageCounts.set(record.stage, (stageCounts.get(record.stage) ?? 0) + 1)
    const month = record.appliedDate.slice(0, 7)
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1)
  }
  const months: string[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1)
  for (let index = 0; index < 6; index++) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return {
    total: records.length,
    byType: [...typeCounts].filter(([, count]) => count > 0).map(([type, count]) => ({ type, count })),
    byStage: [...stageCounts].filter(([, count]) => count > 0).map(([stage, count]) => ({ stage, count })),
    byMonth: months.reverse().map((month) => ({ month, count: monthCounts.get(month) ?? 0 })),
  }
}
