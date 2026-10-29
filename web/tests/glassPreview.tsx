// Separate local-only origin: fictional data, no account and no AI provider requests.
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import App from '../src/App'
import '../src/glass-theme.css'
import { demoExperiences } from '../src/data'
import { ARCHIVE_KEY } from '../src/experienceArchive'
import { blankCareerDraft, CAREER_DRAFT_KEY } from '../src/careerDraft'
import { matchJob, assembleResume } from '../src/jobMatching'
import { indexedDB as previewIndexedDB, IDBKeyRange as PreviewKeyRange } from 'fake-indexeddb'

// This fixture uses memory only; it never reads or replaces an existing local workspace.
const previewValues = new Map<string, string>()
const previewStorage: Storage = {
  get length() { return previewValues.size },
  clear() { previewValues.clear() },
  getItem(key) { return previewValues.get(String(key)) ?? null },
  key(index) { return [...previewValues.keys()][index] ?? null },
  removeItem(key) { previewValues.delete(String(key)) },
  setItem(key, value) { previewValues.set(String(key), String(value)) },
}
Object.defineProperty(window, 'localStorage', { configurable: true, value: previewStorage })
Object.defineProperty(window, 'indexedDB', { configurable: true, value: previewIndexedDB })
Object.defineProperty(window, 'IDBKeyRange', { configurable: true, value: PreviewKeyRange })
{
  const job = '岗位名称：数据分析实习生\n职责：使用 Python 和 SQL 整理数据、制作可视化报告，支持业务分析。\n要求：能解释分析过程，保证内容真实可追溯。'
  const matching = matchJob(job, demoExperiences)
  const draft = { ...blankCareerDraft(), ...matching, generated: true, name: '演示同学', contact: 'demo@example.invalid',
    target: '数据分析实习生', jobText: job, matchedJob: job,
    sections: { ...assembleResume(matching.results, matching.selectedIds, ['Python', 'SQL']), 教育经历: '示例大学 | 数据科学与技术 | 本科\n2022.09 — 2026.06' } }
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify({ schemaVersion: 1, revision: 1, entries: demoExperiences }))
  localStorage.setItem(CAREER_DRAFT_KEY, JSON.stringify({ schemaVersion: 1, revision: crypto.randomUUID(), data: draft }))
  localStorage.setItem('career-archive-theme', 'gold')
}
createRoot(document.getElementById('root')!).render(<App />)
