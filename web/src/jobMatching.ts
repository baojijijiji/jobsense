import type { Experience, ExperienceType } from './types'

export interface Requirement { label: string; aliases: string[]; weight: number }
export interface JobFocus { label: string; quote: string; priority: 'required' | 'preferred' }
export interface MatchAssessment { level: 'direct' | 'transferable' | 'weak'; reason: string; jobEvidence: string[] }
export interface MatchResult {
  source: Experience
  hits: string[]
  evidence: string[]
  score: number
  originalDraft: string
  draft: string
  mode: 'local' | 'ai'
  assessment?: MatchAssessment
  beforeAi?: { draft: string; mode: 'local' | 'ai'; evidence: string[] }
}

export const AI_CANDIDATE_LIMIT = 12
export const DEFAULT_SKILL_SELECTION_COUNT = 10

export function countKeywordHits(item: MatchResult) {
  return new Set(item.hits).size
}

/**
 * Prepare a varied shortlist for semantic review. Local keyword scoring can miss
 * transferable experience, so reserve up to four places for zero-hit entries.
 */
export function selectAiCandidates(results: MatchResult[]) {
  const available = results.filter((item) => item.draft.trim())
  const matched = available.filter((item) => item.hits.length > 0)
  const unmatched = available.filter((item) => item.hits.length === 0)
  const matchedShortlist = matched.slice(0, Math.min(8, AI_CANDIDATE_LIMIT))
  const unmatchedLimit = Math.min(4, AI_CANDIDATE_LIMIT - matchedShortlist.length)

  // Round-robin experience types so one type cannot fill every reserved place.
  const byType = new Map<string, MatchResult[]>()
  for (const item of unmatched) {
    const group = byType.get(item.source.type) ?? []
    group.push(item)
    byType.set(item.source.type, group)
  }
  const diverseUnmatched: MatchResult[] = []
  while (diverseUnmatched.length < unmatchedLimit) {
    let added = false
    for (const group of byType.values()) {
      const item = group.shift()
      if (!item) continue
      diverseUnmatched.push(item)
      added = true
      if (diverseUnmatched.length === unmatchedLimit) break
    }
    if (!added) break
  }

  const chosen = [...matchedShortlist, ...diverseUnmatched]
  const chosenIds = new Set(chosen.map((item) => item.source.id))
  for (const item of available) {
    if (chosen.length >= AI_CANDIDATE_LIMIT) break
    if (chosenIds.has(item.source.id)) continue
    chosen.push(item)
    chosenIds.add(item.source.id)
  }
  return chosen.map((item) => item.source.id)
}

const concepts: [string, string[]][] = [
  ['数据分析', ['数据分析', 'data analysis', 'data analytics', '数据处理', '分析数据']],
  ['数据清洗', ['数据清洗', 'data cleaning', 'data cleansing', '数据预处理']],
  ['数据可视化', ['可视化', 'visualization', 'visualisation', '图表', 'dashboard']],
  ['机器学习', ['机器学习', 'machine learning', '预测模型', '模型训练']],
  ['科研与实验', ['科研', '研究设计', '实验设计', 'research', 'experiment']],
  ['论文与报告', ['论文', '报告撰写', '研究报告', '项目报告', 'report writing', 'academic writing', 'publication']],
  ['沟通协作', ['沟通', '协作', '团队合作', 'communication', 'collaboration', 'teamwork']],
  ['活动组织', ['活动组织', '组织活动', '协助活动', 'event planning', 'event organization', 'event coordination']],
  ['材料整理', ['材料整理', '整理材料', '报名信息', 'documentation', 'document management']],
  ['Python', ['python']], ['SQL', ['sql', 'mysql', 'postgresql']], ['Excel', ['excel']],
  ['JavaScript', ['javascript', 'typescript']], ['React', ['react']], ['统计分析', ['统计分析', 'statistics', 'statistical analysis']],
  ['产品设计', ['产品设计', 'product design', '用户研究', 'user research']],
]

function normalize(text: string) { return text.normalize('NFKC').toLowerCase() }
function contains(text: string, term: string) {
  const normalized = normalize(text)
  const needle = normalize(term)
  if (/^[a-z0-9+#. -]+$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])').test(normalized)
  }
  return normalized.includes(needle)
}

function canonicalSkill(skill: string) {
  const normalized = normalize(skill)
  if (/\bcet[\s-]*4\b|(?:大学)?英语四级/u.test(normalized)) return 'CET-4'
  if (/\bcet[\s-]*6\b|(?:大学)?英语六级/u.test(normalized)) return 'CET-6'
  return skill.trim().replace(/\s+/gu, ' ')
}

function languageCertificates(text: string) {
  const normalized = normalize(text)
  const output: string[] = []
  if (/\bcet[\s-]*4\b|(?:大学)?英语四级/u.test(normalized)) output.push('CET-4')
  if (/\bcet[\s-]*6\b|(?:大学)?英语六级/u.test(normalized)) output.push('CET-6')
  return output
}

export function resumeSkillCandidates(entries: Experience[]) {
  const labels = new Set<string>()
  for (const entry of entries.filter((item) => !item.deletedAt)) {
    for (const skill of entry.skills) {
      const label = canonicalSkill(skill)
      if (label) labels.add(label)
    }
    // Education and achievement fields are common places where users record language certificates.
    for (const certificate of languageCertificates(entry.outcome)) labels.add(certificate)
  }
  return [...labels]
}

export function rankResumeSkills(job: string, entries: Experience[]) {
  const requirements = extractRequirements(job, entries.filter((item) => !item.deletedAt))
  const lines = job.split(/[\n。；;]/u).filter((line) => !/无需|不要求|非必需|not required|no .*required/iu.test(line))
  const languageLines = lines.filter((line) => /英语|英文|外语|语言能力|language|english/iu.test(line))
  const weightFor = (matching: string[]) => matching.length
    ? matching.every((line) => /优先|加分|preferred|a plus|nice to have/iu.test(line)) ? 1 : 2 : 0
  return resumeSkillCandidates(entries).map((skill, index) => {
    const certificate = /^CET-[46]$/u.test(skill)
    const direct = lines.filter((line) => contains(line, skill) || (certificate && languageCertificates(line).includes(skill)))
    const related = requirements.filter((requirement) => requirement.aliases.some((alias) => contains(skill, alias) || contains(alias, skill)))
    const languageWeight = certificate ? weightFor(languageLines) : 0
    const priority = Math.max(weightFor(direct), languageWeight, ...related.map((item) => item.weight), 0)
    const quality = direct.length ? 3 : related.length ? 2 : languageWeight ? 1 : 0
    // Priority dominates match quality. Repeated JD mentions do not inflate the score.
    const score = priority * 100 + quality * 10 + Math.min(related.length, 9)
    const reason = direct.length ? '招聘明确提及' : related.length ? '关联岗位要求：' + related.map((item) => item.label).join('、')
      : languageWeight ? '招聘涉及外语，档案已记录该语言证书' : '暂无关键词关联，可手动勾选'
    return { skill, score, reason, index }
  }).sort((a, b) => b.score - a.score || a.index - b.index)
}

export function suggestResumeSkills(job: string, entries: Experience[], limit = DEFAULT_SKILL_SELECTION_COUNT) {
  const count = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_SKILL_SELECTION_COUNT
  return rankResumeSkills(job, entries).filter((item) => item.score > 0).slice(0, count).map((item) => item.skill)
}

export function extractRequirements(job: string, entries: Experience[]): Requirement[] {
  const lines = job.split(/[\n。；;]/).filter((line) => !/无需|不要求|非必需|not required|no .*required/i.test(line))
  const candidates = [...concepts, ...entries.flatMap((entry) => entry.skills.map((skill): [string, string[]] => [skill, [skill]]))]
  const output: Requirement[] = []
  for (const [label, aliases] of candidates) {
    if (output.some((item) => item.aliases.some((alias) => aliases.includes(alias)))) continue
    const relevant = lines.filter((line) => aliases.some((alias) => contains(line, alias)))
    if (!relevant.length) continue
    output.push({ label, aliases, weight: relevant.every((line) => /优先|加分|preferred|a plus|nice to have/i.test(line)) ? 1 : 2 })
  }
  // Discover domain words from the actual JD, rather than restricting matches to the small alias dictionary.
  const stopWords = new Set(['岗位', '要求', '工作', '负责', '参与', '协助', '熟悉', '掌握', '具备', '能够', '能力', '相关', '专业', '经验', '以上', '优先', '团队', '良好', '项目', '招聘', '任职', '职责', '完成', '进行', '开展', '优秀', '公司', '人员', '学历', '本科', '硕士', '博士', '我们', '实习', '助理', '研究', '管理', '支持', '负责', 'the', 'and', 'with', 'for', 'required', 'experience', 'skills', 'ability'])
  const corpus = entries.map((item) => [item.title, item.role, item.summary, item.outcome, ...item.skills].join('\n')).join('\n')
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  for (const { segment, isWordLike } of segmenter.segment(lines.join('\n').normalize('NFKC'))) {
    const term = segment.toLowerCase()
    if (!isWordLike || term.length < 2 || term.length > 30 || /^\d+$/.test(term) || stopWords.has(term)
      || (/^[a-z]+$/.test(term) && term.length < 3) || !contains(corpus, term)) continue
    if (output.some((item) => item.aliases.some((alias) => normalize(alias).includes(term) || term.includes(normalize(alias))))) continue
    const relevant = lines.filter((line) => contains(line, term))
    output.push({ label: segment, aliases: [segment], weight: relevant.every((line) => /优先|加分|preferred|a plus|nice to have/i.test(line)) ? 1 : 2 })
    if (output.length >= 30) break
  }
  return output.slice(0, 30)
}

function sentences(text: string) {
  return text.split(/[\n。；;]/).map((item) => item.trim().replace(/^[-•·]\s*/, '')).filter(Boolean)
}

export function resumeExperienceBody(type: string, outcome: string, draft: string) {
  const content = draft.trim()
  if (type !== '科研' || !outcome.trim()) return content
  const savedFacts = new Set(sentences(outcome).map((item) => normalize(item.replace(/[。；;,.!?！？]+$/g, ''))))
  const contribution = content.split(/\r?\n/).filter((line) => {
    const clean = normalize(line.trim().replace(/^[-•·]\s*/, '').replace(/[。；;,.!?！？]+$/g, ''))
    return !savedFacts.has(clean)
  }).join('\n').trim()
  return [contribution, '成果与证明：' + outcome.trim()].filter(Boolean).join('\n')
}

export function matchJob(job: string, entries: Experience[]) {
  const active = entries.filter((item) => !item.deletedAt && item.type !== '教育')
  const requirements = extractRequirements(job, active)
  const results: MatchResult[] = active.map((source) => {
    const fields = [source.title, source.summary, source.outcome, source.role, ...source.skills]
    const relevant = requirements.filter((requirement) => fields.some((field) => requirement.aliases.some((alias) => contains(field, alias))))
    const ranked = sentences(source.summary).map((text, index) => ({ text, index,
      score: relevant.reduce((sum, requirement) => sum + (requirement.aliases.some((alias) => contains(text, alias)) ? requirement.weight : 0), 0),
    })).sort((a, b) => b.score - a.score || a.index - b.index)
    const contribution = ranked.slice(0, 2).map((item) => item.text)
    const outcome = sentences(source.outcome).slice(0, 1)
    const bulletText = [...new Set([...contribution, ...outcome])].map((text) => '• ' + text + '。').join('\n')
    const evidence = relevant.map((requirement) => {
      const body = sentences(source.summary + '\n' + source.outcome).find((text) => requirement.aliases.some((alias) => contains(text, alias)))
      return requirement.label + '：' + (body || '档案技能 / 标题 / 角色含相关关键词')
    })
    return { source: { ...source, skills: [...source.skills] }, hits: relevant.map((item) => item.label), evidence,
      score: relevant.reduce((sum, item) => sum + item.weight, 0), originalDraft: bulletText,
      draft: bulletText, mode: 'local' as const }
  }).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
  return { requirements, results, selectedIds: results.filter((item) => item.score > 0 && item.draft).slice(0, 3).map((item) => item.source.id) }
}

export const sectionTitles = ['教育经历', '科研经历', '项目经历', '实习经历', '技能与证书', '校园实践']
const sectionFor: Record<ExperienceType, string> = { 教育: '教育经历', 科研: '科研经历', 项目: '项目经历', 实习: '实习经历', 实践: '校园实践' }

export function assembleEducation(entries: Experience[]) {
  return entries.filter((item) => !item.deletedAt && item.type === '教育').map((item) => {
    const performance = educationPerformance(item.summary) ? item.summary : ''
    const heading = [item.title, item.organization, item.role, performance, item.period, item.location].filter(Boolean).join('|')
    const details = [item.summary && !performance ? '学习方向：' + item.summary : '',
      item.skills.length ? '相关课程：' + item.skills.join('|') : '', item.outcome ? '获得荣誉：' + item.outcome : ''].filter(Boolean)
    return [heading, ...details].join('\n')
  }).join('\n\n')
}

export function educationPerformance(value: string) {
  return /\bGPA\b|绩点|排名|专业前|年级前|前\s*\d{1,2}\s*[%％]/iu.test(value)
}

export function assembleResume(results: MatchResult[], selectedIds: string[], skillSelections: string[] = []) {
  const chosen = results.filter((item) => selectedIds.includes(item.source.id))
  const sections: Record<string, string> = Object.fromEntries(sectionTitles.map((title) => [title, '']))
  for (const item of chosen) {
    const entry = item.source
    const heading = [entry.title, entry.organization, entry.role, entry.period, entry.location].filter(Boolean).join('|')
    const title = sectionFor[entry.type]
    sections[title] += (sections[title] ? '\n\n' : '') + heading + '\n' + resumeExperienceBody(entry.type, entry.outcome, item.draft)
  }
  sections['技能与证书'] = [...new Set(skillSelections.map(canonicalSkill).filter(Boolean))].join('，')
  return sections
}
