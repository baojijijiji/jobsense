import { APPLICATION_RECORDS_KEY, readApplicationRecords } from './applicationRecords.ts'
import { CAREER_DRAFT_KEY } from './careerDraft.ts'
import { TYPOGRAPHY_KEY, parseTypography } from './typography.ts'
import { validateDocument, type WorkspaceData } from './workspaceSchema.ts'
import { DEFAULT_SKILLS_KEY, readDefaultSkills } from './resumeSkillPreferences.ts'

export interface TextTransfer { format: 'jobsense-text-transfer'; version: 1; exportedAt: string; data: Partial<WorkspaceData> }
export function readLocalTextTransfer(): TextTransfer {
  const data: Partial<WorkspaceData> = {}
  if (localStorage.getItem(APPLICATION_RECORDS_KEY) !== null) data.applications = validateDocument('applications', readApplicationRecords(localStorage))
  const rawCareer = localStorage.getItem(CAREER_DRAFT_KEY)
  if (rawCareer !== null) {
    const draft: unknown = JSON.parse(rawCareer)
    if (!draft || typeof draft !== 'object' || !('schemaVersion' in draft) || draft.schemaVersion !== 1 || !('data' in draft)) throw new Error('本机简历草稿格式不可用，已停止导出。')
    data.career = validateDocument('career', draft.data)
  }
  const theme = localStorage.getItem('career-archive-theme'); const typography = localStorage.getItem(TYPOGRAPHY_KEY)
  const themePalette = localStorage.getItem('career-archive-theme-palette')
  if (theme !== null || typography !== null || localStorage.getItem(DEFAULT_SKILLS_KEY) !== null || themePalette !== null) data.preferences = validateDocument('preferences', {
    theme: ['gold', 'green', 'blue', 'dark', 'custom'].includes(theme ?? '') ? theme : 'gold',
    customThemeColor: localStorage.getItem('career-archive-theme-color') ?? '#82938A',
    customThemeMode: localStorage.getItem('career-archive-theme-mode') === 'dark' ? 'dark' : 'light',
    ...(themePalette ? { customThemePalettes: JSON.parse(themePalette) } : {}),
    typography: parseTypography(typography), defaultSkills: readDefaultSkills(localStorage),
  })
  if (!Object.keys(data).length) throw new Error('当前网址没有保存投递记录、简历或设置。请从原来保存资料的浏览器网址导出。')
  return { format: 'jobsense-text-transfer', version: 1, exportedAt: new Date().toISOString(), data }
}
export function parseTextTransfer(contents: string): TextTransfer {
  if (new TextEncoder().encode(contents).byteLength > 4_000_000) throw new Error('文字迁移文件超过 4 MB。')
  const transfer: unknown = JSON.parse(contents)
  if (!transfer || typeof transfer !== 'object' || !('format' in transfer) || transfer.format !== 'jobsense-text-transfer' || !('version' in transfer) || transfer.version !== 1 || !('data' in transfer) || !transfer.data || typeof transfer.data !== 'object' || Array.isArray(transfer.data)) throw new Error('请选择 JobSense 导出的投递与简历迁移 JSON。')
  const source = transfer.data as Record<string, unknown>; const data: Partial<WorkspaceData> = {}
  if (Object.keys(source).some((key) => !['applications', 'career', 'preferences'].includes(key))) throw new Error('文件包含未知资料类型，已停止导入。')
  if (source.applications !== undefined) data.applications = validateDocument('applications', source.applications)
  if (source.career !== undefined) {
    data.career = validateDocument('career', source.career)
    // A migration file is portable across accounts; its old database link is not.
    delete data.career.historyId
    delete data.career.historyVersion
  }
  if (source.preferences !== undefined) data.preferences = validateDocument('preferences', source.preferences)
  if (!Object.keys(data).length) throw new Error('迁移文件没有文字资料。')
  return { format: 'jobsense-text-transfer', version: 1, exportedAt: new Date().toISOString(), data }
}
export function downloadTextTransfer(transfer: TextTransfer, prefix = 'JobSense-投递与简历迁移') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(transfer, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function workspaceTransfer(data: WorkspaceData): TextTransfer {
  return { format: 'jobsense-text-transfer', version: 1, exportedAt: new Date().toISOString(), data }
}
