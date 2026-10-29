import type { CareerDraft } from './careerDraft.ts'
import { validateDocument } from './workspaceSchema.ts'
import { parseTypography, type TypographySettings } from './typography.ts'
import { suggestResumeJobTitle } from './resumeExport.ts'
import { historyDraftIsAligned } from './historyDraft.ts'

export const MATCH_HISTORY_LIMIT = 30
export const HISTORY_SNAPSHOT_BYTE_LIMIT = 1_500_000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export const isHistoryId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)

export interface HistorySnapshot { draft: CareerDraft; typography: TypographySettings; photoDataUrl: string }
export interface HistorySummary { id: string; title: string; createdAt: string; updatedAt: string; version: number }
export interface HistoryRecord extends HistorySummary { original: HistorySnapshot; current: HistorySnapshot }
export interface SaveHistoryInput { id: string; title: string; snapshot: HistorySnapshot; expectedVersion: number | null }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }

export function validHistoryPhoto(value: unknown): value is string {
  if (value === '') return true
  if (typeof value !== 'string' || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/u.test(value)) return false
  const encoded = value.slice('data:image/jpeg;base64,'.length)
  if (encoded.length % 4 !== 0) return false
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return encoded.length / 4 * 3 - padding <= 192 * 1024
}

/** Clone only recognized fields. Rich text is rendered through resumeSectionHtml's sanitizer. */
export function normalizeHistorySnapshot(value: unknown): HistorySnapshot {
  if (!record(value) || !record(value.draft) || !record(value.typography) || !validHistoryPhoto(value.photoDataUrl)) throw new Error('历史记录快照格式不受支持。')
  const rawDraft = { ...value.draft }
  delete rawDraft.historyId
  delete rawDraft.historyVersion
  delete rawDraft.resumePhotoSnapshot
  const draft = validateDocument('career', rawDraft)
  if (!draft.generated || draft.matchedJob.trim().length < 10) throw new Error('请先将岗位匹配结果整理成简历，再保存历史。')
  // Inputs or candidate edits can invalidate a resume even when its JD text is unchanged.
  if (!historyDraftIsAligned(draft)) throw new Error('招聘信息或匹配结果与当前简历不对应，请先整理本次简历。')
  draft.jobText = draft.jobText.trim()
  const typography = parseTypography(JSON.stringify({ version: 1, settings: value.typography }))
  if (Object.entries(typography).some(([key, item]) => value.typography && (value.typography as Record<string, unknown>)[key] !== item)) throw new Error('历史简历的字体或字号设置不受支持。')
  const snapshot = { draft, typography, photoDataUrl: value.photoDataUrl }
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > HISTORY_SNAPSHOT_BYTE_LIMIT) throw new Error('单条历史内容过大，请减少草稿内容后重试。')
  return snapshot
}

export function makeHistoryTitle(snapshot: HistorySnapshot): string {
  const draft = snapshot.draft
  return Array.from((draft.target.trim() || suggestResumeJobTitle(draft.matchedJob)
    || draft.matchedJob.split(/\r?\n/u).find((line) => line.trim())?.trim() || '岗位匹配').replace(/[\u0000-\u001f\u007f]/gu, ' ')).slice(0, 120).join('')
}

export function validateHistorySummary(value: unknown): HistorySummary {
  if (!record(value) || !isHistoryId(value.id) || typeof value.title !== 'string' || !value.title.trim()
    || Array.from(value.title).length > 120 || /[\u0000-\u001f\u007f]/u.test(value.title)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !Number.isSafeInteger(value.version) || (value.version as number) < 1) throw new Error('历史记录编号、标题或版本不受支持。')
  return { id: value.id, title: value.title, createdAt: value.createdAt, updatedAt: value.updatedAt, version: value.version as number }
}

export function validateHistoryRecord(value: unknown): HistoryRecord {
  const summary = validateHistorySummary(value)
  const input = value as Record<string, unknown>
  return { ...summary, original: normalizeHistorySnapshot(input.original), current: normalizeHistorySnapshot(input.current) }
}
