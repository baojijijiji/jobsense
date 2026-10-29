// Local visual fixture only. Not a production build entry and never reads an account.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import '../src/App.css'
import { MatchHistoryPanel } from '../src/MatchHistoryPanel'
import { blankCareerDraft } from '../src/careerDraft'
import { defaultTypography } from '../src/typography'
import { matchJob, assembleResume } from '../src/jobMatching'
import { demoExperiences } from '../src/data'
import type { HistoryRecord } from '../src/matchHistory'

const job = '岗位名称：数据分析实习生\n职责：使用 Python 和 SQL 整理数据，制作可视化报告，支持业务分析。\n要求：能解释分析过程，保持结果真实可追溯。'
const matching = matchJob(job, demoExperiences)
const draft = { ...blankCareerDraft(), ...matching, generated: true, name: '演示同学', contact: 'demo@example.invalid', jobText: job, matchedJob: job,
  sections: assembleResume(matching.results, matching.selectedIds, ['Python', 'SQL']) }
const original = { draft, typography: { ...defaultTypography }, photoDataUrl: '' }
const records: HistoryRecord[] = Array.from({ length: 3 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  title: ['数据分析实习生', '产品助理（虚构岗位）', '测试开发（虚构岗位）'][i], createdAt: `2026-10-${24 - i}T01:00:00Z`, updatedAt: '2026-10-24T02:00:00Z', version: 2,
  original: structuredClone(original), current: { ...structuredClone(original), draft: { ...structuredClone(draft), sections: { ...draft.sections, 技能与证书: 'Python、SQL（修改后的版本）' } } } }))
function Preview() {
  const [open, setOpen] = useState(true)
  const [record, setRecord] = useState(records[0])
  const [restored, setRestored] = useState('尚未调阅')
  return <div style={{ padding: 32 }}><h1>岗位历史 · 虚构资料检查</h1><p role="status">{restored}</p><button className="button" onClick={() => setOpen(true)}>调阅历史记录</button><button className="button" onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'green' : 'dark'}>切换检查主题</button>
    {open && <MatchHistoryPanel summaries={records} record={record} busy={false} loading={false} error="" onSelect={(id) => setRecord(records.find((item) => item.id === id)!)}
      onRefresh={() => undefined} onClose={() => setOpen(false)} onRestore={(item, variant) => { setRestored(`已选择：${item.title} · ${variant === 'original' ? '最初生成' : '最近保存'}`); setOpen(false) }} />}</div>
}
createRoot(document.getElementById('root')!).render(<Preview />)
