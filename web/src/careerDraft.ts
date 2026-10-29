import { AI_CANDIDATE_LIMIT, DEFAULT_SKILL_SELECTION_COUNT, sectionTitles, type MatchResult, type Requirement, type JobFocus } from './jobMatching.ts'
import { validRichSections, lineSpacings, fontSizes, resumeFonts, type ResumeFont } from './resumeFormatting.ts'

export interface CareerDraft {
  /** Links the editable workspace to an explicitly saved account history record. */
  historyId?: string
  historyVersion?: number
  /** JD associated with the assembled resume, independent of the next matching search. */
  resumeJob?: string
  matchRevision?: string
  resumeMatchRevision?: string
  /** Restored historical photo; absence uses the current account photo. */
  resumePhotoSnapshot?: string
  jobText: string
  matchedJob: string
  requirements: Requirement[]
  results: MatchResult[]
  selectedIds: string[]
  /** Obsolete experience-count preference, accepted only for old saved drafts. */
  keywordSelectionCount?: number
  skillSelectionCount?: number
  skillSelections?: string[]
  sections: Record<string, string>
  visible: Record<string, boolean>
  name: string
  contact: string
  contactFont: ResumeFont | ''
  contactSize: number
  target: string
  generated: boolean
  aiEnabled: boolean
  rewriteStyle?: 'concise' | 'standard'
  aiFocus?: JobFocus[]
  richSections?: Record<string, string>
  sectionNames?: Record<string, string>
  lineSpacing?: number
}
export const CAREER_DRAFT_KEY = 'career-archive-job-draft-v1'
export function blankCareerDraft(): CareerDraft {
  return { jobText: '', matchedJob: '', requirements: [], results: [], selectedIds: [], skillSelectionCount: DEFAULT_SKILL_SELECTION_COUNT,
    sections: Object.fromEntries(sectionTitles.map((title) => [title, ''])),
    visible: Object.fromEntries(sectionTitles.map((title) => [title, true])),
    name: '', contact: '', contactFont: '', contactSize: 12, target: '', generated: false, aiEnabled: true, rewriteStyle: 'concise',
    richSections: {}, sectionNames: Object.fromEntries(sectionTitles.map((title) => [title, title])), lineSpacing: 1.65 }
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function validAssessment(value: unknown) {
  return isRecord(value) && ['direct', 'transferable', 'weak'].includes(String(value.level)) && typeof value.reason === 'string' && strings(value.jobEvidence)
}
export function validCareerDraft(value: unknown): value is CareerDraft {
  if (!isRecord(value)) return false
  if (value.historyId !== undefined && (typeof value.historyId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(value.historyId))) return false
  if (value.historyVersion !== undefined && (!value.historyId || typeof value.historyVersion !== 'number' || !Number.isSafeInteger(value.historyVersion) || value.historyVersion < 1)) return false
  if (value.resumeJob !== undefined && typeof value.resumeJob !== 'string') return false
  if (['matchRevision', 'resumeMatchRevision'].some((field) => value[field] !== undefined && (typeof value[field] !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(value[field] as string)))) return false
  if (value.resumePhotoSnapshot !== undefined && (typeof value.resumePhotoSnapshot !== 'string' || value.resumePhotoSnapshot.length > 280000 || (value.resumePhotoSnapshot !== '' && !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/u.test(value.resumePhotoSnapshot)))) return false
  if (!['jobText', 'matchedJob', 'name', 'contact', 'target'].every((field) => typeof value[field] === 'string')) return false
  if (value.contactFont !== undefined && (typeof value.contactFont !== 'string'
    || (value.contactFont !== '' && !Object.hasOwn(resumeFonts, value.contactFont)))) return false
  if (value.contactSize !== undefined && (typeof value.contactSize !== 'number' || !fontSizes.includes(value.contactSize))) return false
  if (!strings(value.selectedIds) || typeof value.generated !== 'boolean' || typeof value.aiEnabled !== 'boolean') return false
  if (value.skillSelections !== undefined && !strings(value.skillSelections)) return false
  if (value.skillSelectionCount !== undefined && (typeof value.skillSelectionCount !== 'number'
    || !Number.isSafeInteger(value.skillSelectionCount) || value.skillSelectionCount < 1)) return false
  if (value.keywordSelectionCount !== undefined && (typeof value.keywordSelectionCount !== 'number'
    || !Number.isInteger(value.keywordSelectionCount) || value.keywordSelectionCount < 1 || value.keywordSelectionCount > AI_CANDIDATE_LIMIT)) return false
  if (value.rewriteStyle !== undefined && value.rewriteStyle !== 'concise' && value.rewriteStyle !== 'standard') return false
  if (value.aiFocus !== undefined && (!Array.isArray(value.aiFocus) || !value.aiFocus.every((item) => isRecord(item) && typeof item.label === 'string' && typeof item.quote === 'string' && ['required', 'preferred'].includes(String(item.priority))))) return false
  if (value.richSections !== undefined && !validRichSections(value.richSections)) return false
  if (value.sectionNames !== undefined && (!isRecord(value.sectionNames) || Object.entries(value.sectionNames).length > sectionTitles.length
    || Object.entries(value.sectionNames).some(([title, name]) => !sectionTitles.includes(title) || typeof name !== 'string' || name.length > 100))) return false
  if (value.lineSpacing !== undefined && (typeof value.lineSpacing !== 'number' || !lineSpacings.includes(value.lineSpacing))) return false
  if (!isRecord(value.sections) || !isRecord(value.visible)) return false
  if (!sectionTitles.every((title) => typeof (value.sections as Record<string, unknown>)[title] === 'string' && typeof (value.visible as Record<string, unknown>)[title] === 'boolean')) return false
  if (!Array.isArray(value.requirements) || !value.requirements.every((item) => isRecord(item) && typeof item.label === 'string' && strings(item.aliases) && typeof item.weight === 'number')) return false
  if (!Array.isArray(value.results) || !value.results.every((item) => {
    if (!isRecord(item) || !isRecord(item.source)) return false
    const source = item.source
    return ['id', 'title', 'summary', 'outcome', 'period', 'organization', 'role', 'updatedAt', 'createdAt'].every((field) => typeof source[field] === 'string')
      && (source.location === undefined || typeof source.location === 'string')
      && ['科研', '项目', '实习', '实践'].includes(String(source.type)) && strings(source.skills) && source.deletedAt === null
      && strings(item.hits) && strings(item.evidence) && typeof item.score === 'number' && typeof item.draft === 'string'
      && typeof item.originalDraft === 'string' && (item.mode === 'local' || item.mode === 'ai')
      && (item.assessment === undefined || validAssessment(item.assessment))
      && (item.beforeAi === undefined || (isRecord(item.beforeAi) && typeof item.beforeAi.draft === 'string'
        && (item.beforeAi.mode === 'local' || item.beforeAi.mode === 'ai') && strings(item.beforeAi.evidence)))
  })) return false
  return value.selectedIds.every((id) => (value.results as MatchResult[]).some((item) => item.source.id === id))
}
