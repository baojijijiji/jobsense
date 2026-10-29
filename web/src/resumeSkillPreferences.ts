export const DEFAULT_SKILLS_KEY = 'career-archive-default-resume-skills-v1'
export const MAX_DEFAULT_SKILLS = 200

/** Match equivalent labels without inferring an unrecorded skill or a higher certificate. */
export function resumeSkillKey(skill: string): string {
  const normalized = skill.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
  if (/^(?:cet[\s-]*4|(?:大学)?英语四级)$/u.test(normalized)) return 'cet-4'
  if (/^(?:cet[\s-]*6|(?:大学)?英语六级)$/u.test(normalized)) return 'cet-6'
  if (/^(?:c\s*\/\s*c\s*\+\s*\+|c\s*\+\s*\+\s*\/\s*c)$/u.test(normalized)) return 'c/c++'
  if (/^(?:c\s*\+\s*\+|cpp)$/u.test(normalized)) return 'c++'
  if (/^(?:c\s*#|csharp|c sharp)$/u.test(normalized)) return 'c#'
  if (normalized === 'js') return 'javascript'
  if (normalized === 'ts') return 'typescript'
  return normalized
}

export function validateDefaultSkills(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_DEFAULT_SKILLS || value.some((skill) =>
    typeof skill !== 'string' || !skill.trim() || skill.length > 60)) throw new Error('默认技能设置格式不受支持，最多保存 200 个已有技能。')
  return distinctResumeSkills(value.map((skill) => skill.trim()))
}

export function distinctResumeSkills<T extends string>(skills: T[]): T[] {
  const seen = new Set<string>()
  return skills.filter((skill) => {
    const key = resumeSkillKey(skill)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Resolve saved labels against the current archive. Missing/deleted skills never get re-created. */
export function availableResumeSkills(requested: string[], available: string[]): string[] {
  const keys = new Set(requested.map(resumeSkillKey))
  return distinctResumeSkills(available.filter((skill) => keys.has(resumeSkillKey(skill))))
}

export function withDefaultResumeSkills(recommended: string[], defaults: string[], available: string[]): string[] {
  return availableResumeSkills([...recommended, ...defaults], available)
}

type LocalSkillStorage = Pick<Storage, 'getItem' | 'setItem'>
export function readDefaultSkills(storage: Pick<LocalSkillStorage, 'getItem'>): string[] {
  const raw = storage.getItem(DEFAULT_SKILLS_KEY)
  if (raw === null) return []
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('skills' in parsed)) {
    throw new Error('本机默认勾选格式不受支持，请重新设置默认勾选。')
  }
  return validateDefaultSkills(parsed.skills)
}

export function writeDefaultSkills(storage: Pick<LocalSkillStorage, 'setItem'>, skills: string[]): string[] {
  const next = validateDefaultSkills(skills)
  storage.setItem(DEFAULT_SKILLS_KEY, JSON.stringify({ version: 1, skills: next }))
  return next
}

export const resumeSkillCategories = [
  { id: 'language', label: '语言与语言证书' },
  { id: 'programming', label: '编程语言' },
  { id: 'data-ai', label: '数据分析与 AI' },
  { id: 'product-design', label: '产品与设计' },
  { id: 'engineering', label: '开发工具与工程' },
  { id: 'business', label: '办公与业务能力' },
  { id: 'certificate', label: '其他资格与证书' },
  { id: 'other', label: '其他技能' },
] as const
export type ResumeSkillCategory = typeof resumeSkillCategories[number]['id']

export function resumeSkillCategory(skill: string): ResumeSkillCategory {
  const key = resumeSkillKey(skill)
  if (/\b(?:cet[\s-]*[46]|ielts|toefl|toeic|tem[\s-]*[48]|jlpt|n[1-5]|delf|dalf|testdaf|pte)\b|英语|英文|日语|法语|德语|韩语|西班牙语|普通话|雅思|托福|多邻国|语言证书|外语|\b(?:english|japanese|french|german|korean|spanish)\b/iu.test(key)) return 'language'
  if (/^(?:python|c|c\+\+|c\/c\+\+|c#|java|javascript|typescript|r|go|golang|rust|swift|kotlin|php|ruby|scala|matlab|julia|sql|bash|shell|powershell|lua|perl|dart|objective-c|vba)(?:\s*(?:语言|编程|开发|基础))?$/u.test(key)) return 'programming'
  if (/证书|资格|认证|驾驶证|计算机[一二三四]级|\b(?:pmp|cpa|cfa|frm|acca|ccna|ccnp|aws certified)\b/iu.test(key)) return 'certificate'
  if (/数据|统计|机器学习|深度学习|人工智能|大模型|提示词|计算机视觉|自然语言|可视化|\b(?:ai|llm|nlp|rag|agent|agents|pytorch|tensorflow|pandas|numpy|scipy|sklearn|scikit-learn|spss|stata|sas|tableau|power\s*bi|hadoop|spark|deepseek|chatgpt|claude)\b/iu.test(key)) return 'data-ai'
  if (/产品|需求|交互|原型|设计|用户研究|用户体验|\b(?:figma|axure|sketch|photoshop|illustrator|adobe|ui|ux|prd|balsamiq)\b/iu.test(key)) return 'product-design'
  if (/开发|工程|测试|部署|版本控制|自动化|云计算|前端|后端|数据库|\b(?:git|github|gitlab|docker|kubernetes|linux|unix|react|vue|angular|next\.js|node\.?js|spring|django|flask|fastapi|mysql|postgresql|redis|mongodb|html|css|webpack|vite|vercel|cloudbase|codex|cursor|api|http|ci\/cd)\b/iu.test(key)) return 'engineering'
  if (/办公|沟通|协作|运营|营销|商业|财务|项目管理|文案|汇报|调研|组织|\b(?:office|excel|word|powerpoint|ppt|notion|crm|erp)\b/iu.test(key)) return 'business'
  return 'other'
}

export function groupResumeSkills<T extends { skill: string }>(skills: T[]) {
  return resumeSkillCategories.map((category) => ({ ...category,
    skills: skills.filter((item) => resumeSkillCategory(item.skill) === category.id),
  })).filter((category) => category.skills.length > 0)
}
