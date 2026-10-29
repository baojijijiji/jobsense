import { APPLICATION_RECORDS_KEY, readApplicationRecords, type ApplicationSnapshot } from './applicationRecords.ts'
import { blankCareerDraft, validCareerDraft, type CareerDraft } from './careerDraft.ts'
import { defaultTypography, parseTypography, type TypographySettings } from './typography.ts'
import type { Theme } from './types'
import { validateDefaultSkills } from './resumeSkillPreferences.ts'

export const documentKeys = ['applications', 'career', 'preferences'] as const
export type DocumentKey = typeof documentKeys[number]
export interface ThemePalette { background: string; card: string; text: string; border: string; accent: string }
export interface CustomThemePalettes { light: ThemePalette; dark: ThemePalette }
export const DEFAULT_CUSTOM_THEME_PALETTES: CustomThemePalettes = {
  light: { background: '#F5F6F3', card: '#FFFEFC', text: '#28302D', border: '#D9E0DC', accent: '#82938A' },
  dark: { background: '#171C1A', card: '#202724', text: '#E9EEEB', border: '#3A4640', accent: '#91A398' },
}

export function defaultCustomThemePalettes(legacyAccent = '#82938A'): CustomThemePalettes {
  return {
    light: { ...DEFAULT_CUSTOM_THEME_PALETTES.light, accent: legacyAccent },
    dark: { ...DEFAULT_CUSTOM_THEME_PALETTES.dark, accent: legacyAccent },
  }
}

export interface AccountPreferences {
  theme: Theme
  customThemeColor?: string
  customThemeMode?: 'light' | 'dark'
  customThemePalettes?: CustomThemePalettes
  typography: TypographySettings
  defaultSkills?: string[]
}
export interface WorkspaceData { applications: ApplicationSnapshot; career: CareerDraft; preferences: AccountPreferences }
export const DOCUMENT_BYTE_LIMIT = 1_000_000

export function defaultWorkspace(): WorkspaceData {
  return { applications: { schemaVersion: 1, revision: '', records: [] }, career: blankCareerDraft(),
    preferences: { theme: 'gold', customThemeColor: '#82938A', customThemeMode: 'light', customThemePalettes: defaultCustomThemePalettes(), typography: { ...defaultTypography }, defaultSkills: [] } }
}

export function validateDocument<K extends DocumentKey>(key: K, value: unknown): WorkspaceData[K] {
  const serialized = JSON.stringify(value)
  // A restored history carries its private compressed photo inside the current draft.
  const byteLimit = key === 'career' && !!value && typeof value === 'object' && 'resumePhotoSnapshot' in value ? 1_500_000 : DOCUMENT_BYTE_LIMIT
  if (!serialized || new TextEncoder().encode(serialized).byteLength > byteLimit) throw new Error(byteLimit === DOCUMENT_BYTE_LIMIT ? '资料过大，单类文字资料最多 1 MB。' : '含历史照片的简历最多 1.5 MB。')
  const clean: unknown = JSON.parse(serialized)
  if (key === 'applications') {
    const snapshot = readApplicationRecords({ getItem: (name) => name === APPLICATION_RECORDS_KEY ? serialized : null, setItem: () => undefined })
    return { schemaVersion: 1, revision: snapshot.revision, records: snapshot.records.map(({ id, company, position, type, stage, appliedDate, createdAt, updatedAt }) =>
      ({ id, company, position, type, stage, appliedDate, createdAt, updatedAt })) } as WorkspaceData[K]
  }
  if (key === 'career') {
    if (!validCareerDraft(clean)) throw new Error('岗位或简历草稿格式不受支持，原资料未被覆盖。')
    const blank = blankCareerDraft()
    const fields = new Set([...Object.keys(blank), 'aiFocus', 'skillSelections', 'keywordSelectionCount', 'historyId', 'historyVersion', 'resumeJob', 'resumePhotoSnapshot', 'matchRevision', 'resumeMatchRevision'])
    return { ...blank, ...Object.fromEntries(Object.entries(clean).filter(([field]) => fields.has(field))) } as WorkspaceData[K]
  }
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) throw new Error('偏好设置格式不受支持。')
  const preferences = clean as AccountPreferences
  if (!['gold', 'green', 'blue', 'dark', 'custom'].includes(preferences.theme) || !preferences.typography || typeof preferences.typography !== 'object') throw new Error('偏好设置字段不受支持。')
  const customThemeColor = preferences.customThemeColor === undefined ? '#82938A' : preferences.customThemeColor
  const customThemeMode = preferences.customThemeMode === undefined ? 'light' : preferences.customThemeMode
  if (typeof customThemeColor !== 'string' || !/^#[\da-f]{6}$/iu.test(customThemeColor) || !['light', 'dark'].includes(customThemeMode)) throw new Error('自定义主题设置格式不受支持。')
  const palettes = preferences.customThemePalettes === undefined ? defaultCustomThemePalettes(customThemeColor) : preferences.customThemePalettes
  if (!palettes || typeof palettes !== 'object') throw new Error('自定义色盘格式不受支持。')
  const validPalette = (palette: unknown): palette is ThemePalette => !!palette && typeof palette === 'object' &&
    ['background', 'card', 'text', 'border', 'accent'].every((field) => typeof (palette as Record<string, unknown>)[field] === 'string' && /^#[\da-f]{6}$/iu.test((palette as Record<string, string>)[field]))
  if (!validPalette(palettes.light) || !validPalette(palettes.dark)) throw new Error('自定义色盘颜色格式不受支持。')
  const typography = parseTypography(JSON.stringify({ version: 1, settings: preferences.typography }))
  if (Object.entries(typography).some(([field, item]) => {
    // Older preferences predate the separate Latin font. Only an absent field receives the new default.
    if (field === 'resumeLatinFont' && !Object.hasOwn(preferences.typography, field)) return false
    return preferences.typography[field as keyof TypographySettings] !== item
  })) throw new Error('字体或字号设置不受支持。')
  return { theme: preferences.theme, customThemeColor, customThemeMode,
    customThemePalettes: { light: { ...palettes.light }, dark: { ...palettes.dark } }, typography, defaultSkills: validateDefaultSkills(preferences.defaultSkills) } as WorkspaceData[K]
}

export function mergeApplicationImport(current: ApplicationSnapshot, incoming: ApplicationSnapshot) {
  const known = new Set(current.records.map((record) => record.id))
  const added = incoming.records.filter((record) => !known.has(record.id))
  return { snapshot: { ...current, revision: added.length ? crypto.randomUUID() : current.revision, records: [...added, ...current.records] },
    added: added.length, skipped: incoming.records.length - added.length }
}
