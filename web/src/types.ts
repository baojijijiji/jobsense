export type PageId = 'home' | 'archive' | 'files' | 'match' | 'applications' | 'resume'
export type Theme = 'gold' | 'green' | 'blue' | 'dark' | 'custom'
export type ExperienceType = '教育' | '科研' | '项目' | '实习' | '实践'

export interface Experience {
  id: string
  title: string
  type: ExperienceType
  period: string
  location?: string
  summary: string
  skills: string[]
  organization: string
  role: string
  outcome: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ExperienceInput = Pick<Experience, 'title' | 'type' | 'period' | 'summary' | 'skills' | 'organization' | 'role' | 'outcome' | 'location'>

