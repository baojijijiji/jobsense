import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { applicationStages, applicationTypes, localDateValue, makeApplicationAiSummary, type ApplicationInput, type ApplicationRecord, type ApplicationStage } from './applicationRecords'
import { useApplicationRecords } from './useApplicationRecords'
import { aiRequest } from './aiClient'

interface Props { onNotice: (text: string) => void; onConfigureAi: () => void }
interface AiStatus { ready: boolean; provider: string; model: string; csrf: string }
interface Analysis { summary: string; observations: string[]; nextSteps: string[] }
const emptyRecords: ApplicationRecord[] = []

function blankInput(): ApplicationInput {
  return { company: '', position: '', type: '', stage: '已投递', appliedDate: localDateValue() }
}

function BarList({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  const maximum = Math.max(1, ...items.map((item) => item.count))
  return <div className="application-chart"><h3>{title}</h3>{items.length ? items.map((item) => <div className="application-bar-row" key={item.label}>
    <span className="application-bar-label">{item.label}</span><span className="application-bar-track"><span className="application-bar-fill" style={{ width: `${item.count / maximum * 100}%` }} /></span><strong>{item.count}</strong>
  </div>) : <p className="matching-note">暂无数据</p>}</div>
}

export function ApplicationTracker({ onNotice, onConfigureAi }: Props) {
  const records = useApplicationRecords()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ApplicationRecord | null>(null)
  const [form, setForm] = useState<ApplicationInput>(blankInput)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<ApplicationStage | ''>('')
  const [aiStatus, setAiStatus] = useState<AiStatus>({ ready: false, provider: '', model: '', csrf: '' })
  const [analysis, setAnalysis] = useState<{ key: string; result: Analysis } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    aiRequest('/api/resume-ai/status', { signal: controller.signal }).then((response) => response.ok ? response.json() : null)
      .then((value) => { if (value && typeof value.ready === 'boolean' && typeof value.provider === 'string' && typeof value.model === 'string' && typeof value.csrf === 'string') setAiStatus(value) })
      .catch(() => { /* Application records and charts work without AI. */ })
    return () => { controller.abort(); request.current?.abort() }
  }, [])

  const allRecords = records.snapshot?.records ?? emptyRecords
  const ordered = useMemo(() => [...allRecords].sort((a, b) => b.appliedDate.localeCompare(a.appliedDate) || b.updatedAt.localeCompare(a.updatedAt)), [allRecords])
  const visible = useMemo(() => {
    const query = search.normalize('NFKC').trim().toLocaleLowerCase()
    return ordered.filter((item) => (!stageFilter || item.stage === stageFilter)
      && (!query || [item.company, item.position, item.type, item.stage].some((value) => value.normalize('NFKC').toLocaleLowerCase().includes(query))))
  }, [ordered, search, stageFilter])
  const stats = useMemo(() => {
    const byStage = applicationStages.map((stage) => ({ label: stage, count: allRecords.filter((item) => item.stage === stage).length })).filter((item) => item.count > 0)
    const byTypeMap = new Map<string, number>()
    for (const record of allRecords) byTypeMap.set(record.type, (byTypeMap.get(record.type) ?? 0) + 1)
    const byType = [...byTypeMap].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    const safeSummary = makeApplicationAiSummary(allRecords)
    const byMonth = safeSummary.byMonth.map((item) => ({ label: item.month, count: item.count }))
    const interviews = allRecords.filter((item) => ['一面', '二面', '终面', 'Offer'].includes(item.stage)).length
    const offers = allRecords.filter((item) => item.stage === 'Offer').length
    const active = allRecords.filter((item) => !['未通过', '已撤回'].includes(item.stage)).length
    return { byStage, byType, byMonth, interviews, offers, active, ai: safeSummary }
  }, [allRecords])

  const aiSummaryKey = JSON.stringify(stats.ai)
  const currentAnalysis = analysis?.key === aiSummaryKey ? analysis.result : null

  function openNew() { setEditing(null); setForm(blankInput()); setFormOpen(true); setError('') }
  function openEdit(record: ApplicationRecord) {
    setEditing(record)
    setForm({ company: record.company, position: record.position, type: record.type, stage: record.stage, appliedDate: record.appliedDate })
    setFormOpen(true); setError('')
  }
  function closeForm() { setFormOpen(false); setEditing(null); setForm(blankInput()); setError('') }
  function save(event: FormEvent) {
    event.preventDefault()
    const result = records.save(form, editing ?? undefined)
    if (!result.ok) { setError(result.message); return }
    closeForm(); onNotice(records.cloudMode ? '投递修改已暂存，正在同步到账号' : editing ? '投递记录已更新' : '投递记录已保存')
  }
  function remove(record: ApplicationRecord) {
    if (!window.confirm(`确定删除“${record.company} · ${record.position}”这条投递记录吗？`)) return
    const result = records.remove(record)
    if (!result.ok) setError(result.message)
    else { setError(''); onNotice(records.cloudMode ? '已从当前列表移除，正在同步' : '已删除投递记录') }
  }

  async function analyze() {
    if (busy || !aiStatus.ready || !allRecords.length) return
    setBusy(true); setError(''); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    try {
      const response = await aiRequest('/api/resume-ai/application-summary', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Career-CSRF': aiStatus.csrf }, body: JSON.stringify(stats.ai) })
      const value = await response.json()
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'AI 分析暂不可用。')
      if (!value || typeof value.summary !== 'string' || !Array.isArray(value.observations) || !value.observations.every((item: unknown) => typeof item === 'string')
        || !Array.isArray(value.nextSteps) || !value.nextSteps.every((item: unknown) => typeof item === 'string')) throw new Error('AI 返回格式不完整。')
      setAnalysis({ key: aiSummaryKey, result: { summary: value.summary, observations: value.observations, nextSteps: value.nextSteps } })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI 分析失败，请稍后重试。')
    } finally { if (request.current === controller) { setBusy(false); request.current = null } }
  }

  return <section className="page-content application-page">
    <div className="page-heading"><div><div className="eyebrow">APPLICATION TRACKER</div><h1>投递记录</h1><p className="lead">记录申请进度，查看投递趋势和阶段分布。</p></div><button className="button primary" onClick={openNew}>＋ 新增投递记录</button></div>
    {records.issue && <div className="attachment-notice" role="alert">{records.issue}<button className="text-link" onClick={records.reload}>重新读取</button></div>}
    {error && <div className="attachment-notice" role="alert">{error}</div>}
    <div className="application-stats-grid">
      <div className="application-stat card"><span>累计投递</span><strong>{allRecords.length}</strong></div>
      <div className="application-stat card"><span>进行中</span><strong>{stats.active}</strong></div>
      <div className="application-stat card"><span>进入面试</span><strong>{stats.interviews}</strong></div>
      <div className="application-stat card"><span>收到 Offer</span><strong>{stats.offers}</strong></div>
    </div>
    <div className="application-analytics-grid">
      <div className="card"><BarList title="最近六个月投递趋势" items={stats.byMonth} /></div>
      <div className="card"><BarList title="职位类型分布" items={stats.byType} /></div>
      <div className="card"><BarList title="当前进度分布" items={stats.byStage} /></div>
    </div>
    <div className="card application-ai-card">
      <div className="card-heading"><div><h2>AI 投递分析</h2><p>分析趋势与阶段分布，给出后续安排建议。</p></div><button className="button primary" disabled={!aiStatus.ready || !allRecords.length || busy} onClick={() => void analyze()}>{busy ? '正在分析…' : 'AI 分析汇总'}</button></div>
      <div className="privacy-note">发送给 DeepSeek 的只有投递总数、固定职位类型/进度分类计数和按月统计；不发送公司名、职位名、联系方式、附件或单条记录。分析需要本机已配置并启用 DeepSeek，每次调用按 DeepSeek 账户计费。{aiStatus.ready ? ` 当前模型：${aiStatus.model}` : ''}</div>
      {!aiStatus.ready && <button className="text-link" onClick={onConfigureAi}>前往岗位匹配配置 DeepSeek</button>}
      {currentAnalysis && <div className="application-analysis-result"><p>{currentAnalysis.summary}</p>
        {!!currentAnalysis.observations.length && <div><h3>观察到的趋势</h3><ul>{currentAnalysis.observations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        {!!currentAnalysis.nextSteps.length && <div><h3>可尝试的下一步</h3><ul>{currentAnalysis.nextSteps.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      </div>}
    </div>
    <div className="card application-table-card">
      <div className="card-heading"><div><h2>申请明细</h2><p>{visible.length} 条记录</p></div><label className="application-search">搜索<input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="公司、职位、类型" /></label><label className="application-stage-filter">进度<select value={stageFilter} onChange={(event) => setStageFilter(event.currentTarget.value as ApplicationStage | '')}><option value="">全部</option>{applicationStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label></div>
      {visible.length ? <div className="application-table-wrap"><table className="application-table"><thead><tr><th>投递日期</th><th>公司</th><th>职位</th><th>职位类型</th><th>面试进度</th><th>操作</th></tr></thead><tbody>
        {visible.map((record) => <tr key={record.id}><td>{record.appliedDate}</td><td>{record.company}</td><td>{record.position}</td><td>{record.type}</td><td><span className="application-stage-tag">{record.stage}</span></td><td><div className="application-row-actions"><button className="text-link" onClick={() => openEdit(record)}>编辑</button><button className="text-link" onClick={() => remove(record)}>删除</button></div></td></tr>)}
      </tbody></table></div> : <div className="application-empty"><strong>{allRecords.length ? '没有找到符合条件的记录' : '还没有投递记录'}</strong><p>{allRecords.length ? '可以调整搜索词或进度筛选。' : '新增一条申请后，这里会自动整理进度表和投递统计。'}</p>{!allRecords.length && <button className="button" onClick={openNew}>添加第一条记录</button>}</div>}
    </div>
    {formOpen && <div className="application-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm() }}>
      <form className="application-form card" onSubmit={save} aria-label={editing ? '编辑投递记录' : '新增投递记录'}>
        <div className="card-heading"><h2>{editing ? '编辑投递记录' : '新增投递记录'}</h2><button className="text-link" type="button" onClick={closeForm}>关闭</button></div>
        <label>公司名称<input required maxLength={150} value={form.company} onChange={(event) => { const company = event.currentTarget.value; setForm((previous) => ({ ...previous, company })) }} /></label>
        <label>职位名称<input required maxLength={150} value={form.position} onChange={(event) => { const position = event.currentTarget.value; setForm((previous) => ({ ...previous, position })) }} /></label>
        <label>职位类型<input required maxLength={40} list="application-type-options" value={form.type} placeholder="例如：校招、实习、全职" onChange={(event) => { const type = event.currentTarget.value; setForm((previous) => ({ ...previous, type })) }} /><datalist id="application-type-options">{applicationTypes.map((type) => <option key={type} value={type} />)}</datalist></label>
        <label>当前进度<select value={form.stage} onChange={(event) => { const stage = event.currentTarget.value as ApplicationStage; setForm((previous) => ({ ...previous, stage })) }}>{applicationStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
        <label>投递日期<input type="date" required value={form.appliedDate} onChange={(event) => { const appliedDate = event.currentTarget.value; setForm((previous) => ({ ...previous, appliedDate })) }} /></label>
        <p className="hint">{records.cloudMode ? '记录随当前账号同步，保存结果见顶部状态。' : '记录保存在当前浏览器，可使用顶部“导出投递与简历”迁移到账号。'}</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="button-row end-row"><button className="button" type="button" onClick={closeForm}>取消</button><button className="button primary" type="submit">保存记录</button></div>
      </form>
    </div>}
  </section>
}
