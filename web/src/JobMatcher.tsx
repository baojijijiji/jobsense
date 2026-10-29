import { useContext, useEffect, useRef, useState } from 'react'
import { aiRequest } from './aiClient'
import { CloudAccountContext } from './cloudbaseContext'
import type { Experience } from './types'
import { AI_CANDIDATE_LIMIT, DEFAULT_SKILL_SELECTION_COUNT, assembleEducation, assembleResume, countKeywordHits, matchJob, rankResumeSkills, selectAiCandidates, suggestResumeSkills, type MatchAssessment, type JobFocus } from './jobMatching'
import { makeEducationRichSections, makeExperienceRichSections } from './resumeFormatting'
import type { CareerDraft } from './useCareerDraft'
import { availableResumeSkills, groupResumeSkills, resumeSkillKey, withDefaultResumeSkills } from './resumeSkillPreferences'
import { useDefaultResumeSkills } from './useDefaultResumeSkills'

interface Props {
  entries: Experience[]
  data: CareerDraft
  update: (change: (previous: CareerDraft) => CareerDraft) => boolean
  onResume: () => void
  onArchive: () => void
  onNotice: (text: string) => void
  onGenerated?: (draft: CareerDraft) => void
  onHistory?: () => void
  historyBlocked?: boolean
}
interface AiStatus { ready: boolean; provider: string; model: string; csrf: string; configured: boolean; configurationMode?: 'server'; authentication?: 'bearer' }
interface AiResult { id: string; text: string; evidence: string[]; assessment: MatchAssessment }
const assessmentLabel = { direct: '直接相关', transferable: '可迁移经验', weak: '关联较弱' }
const cloudbaseStatic = import.meta.env.VITE_CLOUDBASE_MODE === 'true'

export function JobMatcher({ entries, data, update, onResume, onArchive, onNotice, onGenerated, onHistory, historyBlocked }: Props) {
  const [status, setStatus] = useState<AiStatus>({ ready: false, provider: '', model: '', csrf: '', configured: false })
  const [serviceState, setServiceState] = useState<'checking' | 'connected' | 'unavailable'>('checking')
  const [serviceError, setServiceError] = useState('')
  const account = useContext(CloudAccountContext)
  const skillDefaults = useDefaultResumeSkills()
  const [configOpen, setConfigOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [failure, setFailure] = useState('')
  const request = useRef<AbortController | null>(null)
  const requestVersion = useRef(0)
  const latest = useRef(data)
  const latestEntries = useRef(entries)
  useEffect(() => { latest.current = data; latestEntries.current = entries }, [data, entries])
  useEffect(() => {
    const controller = new AbortController()
    aiRequest('/api/resume-ai/status', { signal: controller.signal }).then(async (response) => {
      const value = await response.json()
      if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'AI 后台未能完成连接。')
      return value
    })
      .then((value) => {
        if (controller.signal.aborted) return
        if (value && typeof value.ready === 'boolean' && typeof value.provider === 'string' && typeof value.model === 'string'
          && typeof value.csrf === 'string' && (!!value.csrf || (cloudbaseStatic && value.authentication === 'bearer')) && typeof value.configured === 'boolean') {
          setStatus(value); setServiceState('connected')
        } else setServiceState('unavailable')
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) { setServiceState('unavailable'); setServiceError(error instanceof Error ? error.message : 'AI 后台未能完成连接。') } })
    return () => { controller.abort(); request.current?.abort() }
  }, [])
  const selected = data.results.filter((item) => data.selectedIds.includes(item.source.id))
  const rankedSkills = rankResumeSkills(data.matchedJob, entries).filter((item, index, all) =>
    all.findIndex((candidate) => resumeSkillKey(candidate.skill) === resumeSkillKey(item.skill)) === index)
  const skillOptions = rankedSkills.map((item) => item.skill)
  const skillGroups = groupResumeSkills(rankedSkills.map((item, index) => ({ ...item, rank: index + 1 })))
  const availableDefaults = availableResumeSkills(skillDefaults.defaults, skillOptions)
  const skillCountLimit = Math.max(1, skillOptions.length)
  const preferredSkillCount = Math.min(data.skillSelectionCount ?? DEFAULT_SKILL_SELECTION_COUNT, skillCountLimit)
  const recommendedSkills = withDefaultResumeSkills(rankedSkills.filter((item) => item.score > 0).slice(0, preferredSkillCount).map((item) => item.skill), skillDefaults.defaults, skillOptions)
  const skillSelections = availableResumeSkills(data.skillSelections ?? recommendedSkills, skillOptions)
  const availableSkillSelections = skillSelections
  const activeSources = new Map(entries.filter((entry) => !entry.deletedAt && entry.type !== '教育').map((entry) => [entry.id, entry]))
  const changed = activeSources.size !== data.results.length || data.results.some((item) => {
    const source = activeSources.get(item.source.id)
    return !source || source.updatedAt !== item.source.updatedAt
  })
  const outdated = data.matchedJob !== data.jobText.trim() || changed
  const gaps = data.requirements.filter((requirement) => !selected.some((item) => item.hits.includes(requirement.label)))
  const localConfigurationAvailable = serviceState === 'connected' && !cloudbaseStatic && status.configurationMode !== 'server'
  const unavailableMessage = cloudbaseStatic
    ? `${serviceError || 'AI 后台未能完成连接。'} 可以继续使用左侧的自动挑选和草稿编辑。`
    : '未连接到 AI 后台，暂时不能保存密钥或调用 DeepSeek。请启动提供 AI 接口的应用服务后刷新页面。'
  const aiDisabledReason = serviceState === 'checking' ? '正在连接 AI 服务……'
    : serviceState === 'unavailable' ? unavailableMessage
    : !status.ready ? cloudbaseStatic || status.configurationMode === 'server'
      ? 'AI 后台已连接，DeepSeek 尚未在服务器启用。' : '请先配置并启用 DeepSeek。'
    : !data.aiEnabled ? '请勾选“启用外部 AI 改写”。'
    : outdated ? '请先点击左侧按钮，按当前招聘信息重新准备候选。'
    : !selected.length ? '请先勾选至少一段候选经历。' : ''

  function selectSkills(count: number) {
    if (busy) return
    if (outdated) { setFailure('招聘信息或经历档案已变化，请先重新分析，再挑选技能关键词。'); return }
    if (!Number.isSafeInteger(count) || count < 1 || count > skillCountLimit) { setFailure(`请输入 1–${skillCountLimit} 之间的整数。`); return }
    const rankedSelection = rankedSkills.filter((item) => item.score > 0).slice(0, count).map((item) => item.skill)
    const skills = withDefaultResumeSkills(rankedSelection, skillDefaults.defaults, skillOptions)
    if (update((previous) => ({ ...previous, skillSelectionCount: count, skillSelections: skills }))) {
      setFailure('')
      onNotice(`已勾选 ${rankedSelection.length} 个相关关键词${availableDefaults.length ? '，并加入默认勾选' : ''}，共 ${skills.length} 个，可继续手动调整`)
    }
  }

  function saveSkillDefaults() {
    if (skillDefaults.save(availableSkillSelections)) onNotice(skillDefaults.accountDefaults
      ? '默认勾选已更新，随账号同步；下次准备岗位候选时自动加入'
      : '默认勾选已记在本机；下次准备岗位候选时自动加入')
  }

  function applySkillDefaults() {
    if (update((previous) => ({ ...previous,
      skillSelections: withDefaultResumeSkills(previous.skillSelections ?? recommendedSkills, skillDefaults.defaults, skillOptions),
    }))) onNotice(`已加入当前档案中的 ${availableDefaults.length} 个默认勾选，可继续手动取消`)
  }

  function clearSkillDefaults() {
    // A legacy draft may still display its computed selection. Freeze it before changing defaults.
    if (data.skillSelections === undefined && !update((previous) => ({ ...previous, skillSelections: availableSkillSelections }))) return
    if (skillDefaults.save([])) onNotice(skillDefaults.accountDefaults
      ? '默认勾选已清空，随账号同步；本次勾选保留'
      : '本机默认勾选已清空；本次勾选保留')
  }

  function runMatch() {
    const job = data.jobText.trim()
    if (job.length < 10) { setFailure('请粘贴完整一些的岗位职责和要求（至少 10 个字）。'); return }
    if (data.results.some((item) => item.mode === 'ai' || item.draft !== item.originalDraft)
      && !window.confirm('重新挑选会替换当前岗位匹配草稿中的修改，已整理到简历编辑页的内容会保留。继续重新挑选？')) return
    const result = matchJob(job, entries)
    const semantic = status.ready && data.aiEnabled
    const next = { ...data, resumeJob: data.resumeJob ?? data.matchedJob, matchedJob: job, ...result, aiFocus: undefined,
      selectedIds: semantic ? selectAiCandidates(result.results) : result.selectedIds,
      skillSelections: withDefaultResumeSkills(suggestResumeSkills(job, entries, data.skillSelectionCount ?? DEFAULT_SKILL_SELECTION_COUNT), skillDefaults.defaults, skillOptions) }
    if (update(() => next)) {
      setFailure('')
      onNotice(semantic ? '已准备候选，请检查勾选范围，再让 AI 挑选' : result.selectedIds.length ? '已按招聘信息挑选经历，草稿可继续修改' : entries.some((item) => !item.deletedAt && item.type === '教育') ? '已准备岗位信息；教育经历可直接整理到简历，其他经历可继续补充' : '暂未找到关键词关联，可手动勾选经历或补充档案')
    }
  }

  async function configure(remove = false) {
    if (busy || !localConfigurationAvailable) return
    if (remove && !window.confirm('移除本机保存的 DeepSeek 密钥并关闭 AI？已保存的草稿会保留。')) return
    setBusy(true); setFailure('')
    try {
      const response = await aiRequest('/api/resume-ai/configure', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Career-CSRF': status.csrf },
        body: JSON.stringify(remove ? { action: 'remove' } : { action: 'save', apiKey: keyInput.trim(), accepted }) })
      const value = await response.json()
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : '配置保存失败。')
      setStatus(value); setKeyInput(''); setAccepted(false); setConfigOpen(false)
      onNotice(remove ? '已移除本机密钥' : '已保存配置；生成草稿时将调用 DeepSeek')
    } catch (error) { setFailure(error instanceof Error ? error.message : '配置服务不可用，请重新运行本地应用。') }
    finally { setBusy(false) }
  }

  async function rewrite(snapshot = data, rank = false) {
    const chosen = snapshot.results.filter((item) => snapshot.selectedIds.includes(item.source.id))
    if (busy || !status.ready || !snapshot.aiEnabled || !chosen.length) return
    if (chosen.length > 12) { setFailure('一次最多改写 12 段经历，请减少勾选。'); return }
    const controller = new AbortController()
    request.current = controller
    const version = ++requestVersion.current
    setBusy(true); setGenerating(true); setFailure('')
    try {
      const response = await aiRequest('/api/resume-ai/rewrite', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Career-CSRF': status.csrf }, body: JSON.stringify({ job: snapshot.matchedJob, selection: rank ? 'rank' : 'keep', style: snapshot.rewriteStyle ?? 'concise',
          entries: chosen.map(({ source }) => ({ id: source.id, title: source.title, type: source.type,
            summary: source.summary, outcome: source.outcome, role: source.role, skills: source.skills })) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'AI 改写暂时不可用。')
      if (controller.signal.aborted || version !== requestVersion.current) return
      if (latest.current !== snapshot) throw new Error('等待期间草稿已有修改，未覆盖当前内容。请重新生成。')
      if (chosen.some((item) => !latestEntries.current.some((entry) => entry.id === item.source.id && !entry.deletedAt && entry.updatedAt === item.source.updatedAt))) throw new Error('等待期间原始经历已变化，未覆盖草稿。请重新挑选。')
      if (!Array.isArray(result.entries) || result.entries.length !== chosen.length
        || !result.entries.every((item: AiResult) => item && typeof item.id === 'string' && chosen.some((entry) => entry.source.id === item.id)
          && typeof item.text === 'string' && Array.isArray(item.evidence) && item.evidence.every((text: unknown) => typeof text === 'string'))
        || new Set(result.entries.map((item: AiResult) => item.id)).size !== chosen.length) throw new Error('AI 返回格式不完整，已保留原草稿。')
      if (!Array.isArray(result.jobFocus) || !result.jobFocus.every((focus: JobFocus) => focus && typeof focus.label === 'string' && typeof focus.quote === 'string'
          && snapshot.matchedJob.includes(focus.quote) && ['required', 'preferred'].includes(focus.priority))
        || !Array.isArray(result.recommendedIds) || !result.recommendedIds.every((id: unknown) => typeof id === 'string' && chosen.some((item) => item.source.id === id))
        || new Set(result.recommendedIds).size !== result.recommendedIds.length || (rank && result.recommendedIds.length > 3)
        || !result.entries.every((item: AiResult) => item.assessment && ['direct', 'transferable', 'weak'].includes(item.assessment.level)
          && typeof item.assessment.reason === 'string' && Array.isArray(item.assessment.jobEvidence)
          && item.assessment.jobEvidence.every((quote: string) => typeof quote === 'string' && snapshot.matchedJob.includes(quote)))) throw new Error('AI 匹配依据格式不完整，已保留原草稿。')
      if (result.warnings !== undefined && (!Array.isArray(result.warnings) || !result.warnings.every((warning: unknown) => typeof warning === 'string'))) throw new Error('AI 提示格式不完整，已保留原草稿。')
      const output: AiResult[] = result.entries
      const saved = update((previous) => ({ ...previous, aiFocus: result.jobFocus, selectedIds: rank ? result.recommendedIds : previous.selectedIds,
        results: previous.results.map((item) => {
        const generated = output.find((entry) => entry.id === item.source.id)
        if (!generated) return item
        if (!generated.text.trim()) return { ...item, assessment: generated.assessment }
        return { ...item, assessment: generated.assessment, beforeAi: { draft: item.draft, mode: item.mode, evidence: item.evidence }, draft: generated.text, mode: 'ai' as const, evidence: generated.evidence.map((text) => '原文依据：' + text) }
      }).sort((a, b) => {
        if (!rank) return 0
        const aIndex = output.findIndex((entry) => entry.id === a.source.id)
        const bIndex = output.findIndex((entry) => entry.id === b.source.id)
        return (aIndex < 0 ? output.length : aIndex) - (bIndex < 0 ? output.length : bIndex)
      }) }))
      if (saved) {
        if (result.warnings?.length) setFailure(result.warnings.join(''))
        onNotice(rank ? result.recommendedIds.length ? `AI 已推荐 ${result.recommendedIds.length} 段经历，请核对后进入简历` : '候选与岗位关联较弱，未强行推荐；可以重新选择候选' : '已按岗位重点改写，原文依据可展开查看')
      }
    } catch (error) {
      if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : 'AI 请求失败，原草稿已保留。')
    } finally { if (version === requestVersion.current) { setBusy(false); setGenerating(false); request.current = null } }
  }

  function useResume() {
    if (historyBlocked) { setFailure('请先处理上一条历史的保存提示，再生成新的岗位简历。'); return }
    if (outdated) { setFailure('岗位或原始档案已变化，请重新挑选。'); return }
    const education = assembleEducation(entries)
    if ((!selected.length && !education) || selected.some((item) => !item.draft.trim())) { setFailure('请勾选有内容的经历，或先在经历库填写教育经历。'); return }
    if (data.generated && !window.confirm('用本次所选经历更新简历？科研、项目、实习、实践和技能栏目会重新整理；教育栏目将使用经历库中的教育资料（没有教育资料时保留现有内容），个人信息保留。')) return
    const sections = assembleResume(data.results, data.selectedIds, availableSkillSelections)
    const richSections = { ...data.richSections }
      for (const title of Object.keys(sections)) if (title !== '教育经历') delete richSections[title]
      if (education) delete richSections['教育经历']
    const next: CareerDraft = { ...data, generated: true, resumeJob: data.matchedJob, resumeMatchRevision: data.matchRevision,
        target: (data.resumeJob ?? data.matchedJob) === data.matchedJob ? data.target : '',
        historyId: onGenerated ? crypto.randomUUID() : undefined, historyVersion: undefined,
        sections: { ...sections, 教育经历: education || data.sections['教育经历'] },
        richSections: { ...richSections, ...makeExperienceRichSections(data.results, data.selectedIds), ...makeEducationRichSections(entries) },
      }
    if (update(() => next)) {
      onGenerated?.(next)
      onResume(); onNotice('已整理到简历，请核对并修改后导出')
    }
  }

  return <section className="page-content">
    <div className="page-heading"><div><div className="eyebrow">JOB-TO-EXPERIENCE MATCH</div><h1>岗位匹配</h1><p className="lead">从招聘要求挑选经历，整理为可修改的中文简历。</p></div>{onHistory && <button className="button" disabled={busy} onClick={onHistory}>调阅历史记录</button>}</div>
    <div className="match-layout">
      <div className="card">
        <label className="form-label" htmlFor="job-description">目标岗位招聘信息</label>
        <textarea id="job-description" className="job-input" maxLength={16000} disabled={busy} value={data.jobText}
          onChange={(event) => { const jobText = event.currentTarget.value; update((previous) => ({ ...previous, jobText })) }}
          placeholder="粘贴中文或英文的岗位职责、技能和经验要求……" />
        <p className="hint">本地先整理候选。启用 AI 时预选最多 12 段，也包含未命中关键词的经历，供 AI 比较内容；可自行增减勾选。</p>
        <button className="button primary" disabled={busy || !entries.some((item) => !item.deletedAt)} onClick={runMatch}>{status.ready && data.aiEnabled ? '分析招聘信息，准备匹配候选' : '自动挑选经历并整理草稿'}　→</button>
        {!entries.some((item) => !item.deletedAt) && <p className="inline-error">经历库为空。<button className="text-link" onClick={onArchive}>先添加经历</button></p>}
      </div>
      <div className="card">
        <div className="card-heading"><h2>中文改写</h2><span className="tag">{status.ready ? status.provider : serviceState === 'checking' ? 'AI 连接中' : serviceState === 'unavailable' ? 'AI 服务未连接' : 'AI 待配置'}</span></div>
        <p className="matching-note">AI 比较勾选经历与岗位的任务、领域和方法，挑选至多 3 段并改写中文；不局限于相同关键词。结果附匹配理由和招聘原句。</p>
        <label className="section-toggle"><input type="checkbox" disabled={busy} checked={data.aiEnabled}
          onChange={(event) => { const aiEnabled = event.currentTarget.checked; update((previous) => ({ ...previous, aiEnabled })) }} />启用外部 AI 改写</label>
        <div className="privacy-note">仅发送本次招聘信息和勾选经历的标题、类型、角色、技能、贡献及成果。不发送个人信息栏、图片、完整附件。{cloudbaseStatic && 'AI 请求经 Vercel 境外后台转交 DeepSeek，后台以登录令牌核对账号及所选经历归属。'}{status.ready ? `模型：${status.model}` : '尚未配置服务，当前不会发送任何资料到模型。'}</div>
        <label className="form-label" htmlFor="rewrite-length">中文草稿长度</label>
        <select className="rewrite-length" id="rewrite-length" disabled={busy} value={data.rewriteStyle ?? 'concise'} onChange={(event) => { const rewriteStyle = event.currentTarget.value as 'concise' | 'standard'; update((previous) => ({ ...previous, rewriteStyle })) }}>
          <option value="concise">简洁 · 每段 1–2 条</option><option value="standard">标准 · 每段 1–3 条</option></select>
        <button className="button primary full-button" title={aiDisabledReason || undefined} aria-describedby={aiDisabledReason ? 'ai-disabled-reason' : undefined} disabled={busy || !!aiDisabledReason} onClick={() => void rewrite(data, true)}>AI 挑选并改写候选经历</button>
        <button className="button full-button" title={aiDisabledReason || undefined} aria-describedby={aiDisabledReason ? 'ai-disabled-reason' : undefined} disabled={busy || !!aiDisabledReason} onClick={() => void rewrite()}>保留勾选，只改写文字</button>
        {aiDisabledReason && <p className="matching-note" id="ai-disabled-reason" role="status">{aiDisabledReason}</p>}
        <button className="text-link" disabled={busy || serviceState === 'checking'} onClick={() => { setConfigOpen((open) => !open); setKeyInput('') }}>{localConfigurationAvailable ? '配置 DeepSeek' : 'AI 接入说明'}</button>
        {configOpen && account && <p className="matching-note">配置专属 AI 时使用的账号编号：<code style={{ overflowWrap: 'anywhere' }}>{account.id}</code></p>}
        {configOpen && serviceState === 'unavailable' && <div className="ai-config"><p className="matching-note">{unavailableMessage}</p>
          {cloudbaseStatic && <p className="matching-note">在 Vercel 配置服务器密钥和允许使用的账号，执行 AI 限额脚本，再连接网站的 AI 后台地址。完成设置后刷新本页即可启用，无需在网页保存密钥。</p>}</div>}
        {configOpen && serviceState === 'connected' && !localConfigurationAvailable && <div className="ai-config"><p className="matching-note">线上密钥由部署平台环境变量管理，不会写入浏览器。{status.ready ? '服务器已启用DeepSeek，可以直接挑选和改写。' : '请在部署平台配置DEEPSEEK_API_KEY并重新部署。'}</p></div>}
        {configOpen && localConfigurationAvailable && <form className="ai-config" onSubmit={(event) => { event.preventDefault(); void configure() }}>
          <label htmlFor="deepseek-key">API 密钥（只保存在本机服务端）</label>
          <input id="deepseek-key" type="password" autoComplete="new-password" maxLength={200} value={keyInput} disabled={busy} onChange={(event) => setKeyInput(event.currentTarget.value)} required />
          <p className="matching-note">从 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek 开放平台</a>获取 API 密钥。网页版聊天账号本身不能替代 API 密钥。本机配置文件含密钥，请勿分享。</p>
          <p className="matching-note">每次改写按 DeepSeek 账户计费。处理范围见上方说明；服务商留存按其政策执行，不能保证零留存。查看<a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">官方计费</a>、<a href="https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html" target="_blank" rel="noreferrer">隐私政策</a>和<a href="https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html" target="_blank" rel="noreferrer">用户协议</a>。</p>
          <label className="section-toggle"><input type="checkbox" checked={accepted} disabled={busy} onChange={(event) => setAccepted(event.currentTarget.checked)} />我已了解上述处理范围、服务条款和账户计费，启用此配置</label>
          <button className="button primary" disabled={busy || !accepted || !keyInput.trim() || !status.csrf}>保存并启用</button>
          {status.configured && <button type="button" className="text-link" disabled={busy} onClick={() => void configure(true)}>移除本机密钥</button>}
        </form>}
        {busy && generating && <div className="button-row"><span role="status">正在比较候选并生成中文草稿……</span><button className="text-link" onClick={() => { request.current?.abort(); request.current = null; requestVersion.current++; setBusy(false); setGenerating(false); setFailure('已取消生成，原草稿已保留。') }}>取消</button></div>}
      </div>
    </div>
    {failure && <p className="attachment-notice" role="alert">{failure}</p>}
    {data.matchedJob && <div className="match-results">
      {outdated && <p className="attachment-notice" role="alert">招聘信息或经历档案已变化，请重新挑选。现有简历仍保留。</p>}
      <div className="card requirements-card"><h2>{data.aiFocus?.length ? 'AI 识别的岗位重点' : '本地识别的关键词'}</h2>
        {data.aiFocus?.length ? <ul>{data.aiFocus.map((focus, index) => <li key={index}><strong>{focus.label}{focus.priority === 'preferred' ? '（加分）' : ''}</strong><p className="matching-note">招聘原句：{focus.quote}</p></li>)}</ul>
          : <p>{data.requirements.map((item) => item.label + (item.weight === 1 ? '（加分）' : '')).join(' · ') || '暂无可识别关键词，仍可用 AI 评估已勾选候选。'}</p>}
        {!!gaps.length && <p className="matching-note">所选档案未找到：{gaps.map((item) => item.label).join('、')}。这些要求不会写成已具备的技能。</p>}
      </div>
      <div className="card skill-checklist-card">
        <div className="card-heading"><h2>技能与证书（智能勾选）</h2><span className="tag">已勾选 {availableSkillSelections.length} 个</span></div>
        <p className="matching-note">按技能类型分组，组内按招聘相关度排序，可手动调整。候选只来自已记录的档案。</p>
        <div className="skill-default-actions">
          <button className="button" disabled={busy || outdated || !availableSkillSelections.length} onClick={saveSkillDefaults}>将当前勾选设为默认</button>
          <button className="button" disabled={busy || outdated || !availableDefaults.length} onClick={applySkillDefaults}>加入默认勾选</button>
          <button className="text-link" disabled={busy || !skillDefaults.defaults.length} onClick={clearSkillDefaults}>清空默认</button>
        </div>
        <p className="matching-note">已设 {skillDefaults.defaults.length} 个默认项{skillDefaults.defaults.length > availableDefaults.length ? `（当前档案可用 ${availableDefaults.length} 个）` : ''}。{skillDefaults.accountDefaults ? '默认选择跟随当前账号。' : '默认选择保存在当前浏览器。'}每次准备岗位候选或智能勾选时自动加入，仍可手动取消；档案中已删除的技能不会补入。</p>
        {skillDefaults.error && <p className="inline-error" role="alert">{skillDefaults.error}</p>}
        <form className="skill-selection-controls" onSubmit={(event) => {
          event.preventDefault()
          const input = event.currentTarget.elements.namedItem('skillCount') as HTMLInputElement
          selectSkills(input.valueAsNumber)
        }}>
          <div><label className="form-label" htmlFor="skill-selection-count">选择关键词数量</label>
            <input key={`${data.skillSelectionCount ?? DEFAULT_SKILL_SELECTION_COUNT}-${skillCountLimit}`} id="skill-selection-count" name="skillCount"
              type="number" min={1} max={skillCountLimit} step={1} required defaultValue={preferredSkillCount}
              disabled={busy || outdated || !skillOptions.length} aria-describedby="skill-selection-help" /></div>
          <button className="button primary" disabled={busy || outdated || !skillOptions.length}>智能勾选前N个</button>
        </form>
        <p className="matching-note" id="skill-selection-help">N 为相关关键词数量，默认项额外加入并去重。必需要求优先于加分项；相关项不足不强行补齐。序号为整体相关度排名，灰色表示暂无关键词关联。</p>
        {skillOptions.length ? <div className="skill-groups">{skillGroups.map((group) => <fieldset className="skill-group" key={group.id}>
          <legend className="skill-group-heading">{group.label} <span>已选 {group.skills.filter(({ skill }) => skillSelections.includes(skill)).length}/{group.skills.length}</span></legend>
          <div className="skill-checklist">{group.skills.map(({ skill, score, reason, rank }) => <label className="skill-option" key={skill} title={reason}>
            <input type="checkbox" checked={skillSelections.includes(skill)} disabled={busy || outdated}
              onChange={() => update((previous) => {
                const current = availableResumeSkills(previous.skillSelections ?? recommendedSkills, skillOptions)
                return { ...previous, skillSelections: current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill] }
              })} /><span className={`skill-rank${score ? '' : ' unrelated'}`}>{rank}.</span>{skill}{availableDefaults.includes(skill) && <span className="tag">默认</span>}
          </label>)}</div>
        </fieldset>)}</div> : <p className="matching-note">档案中还没有填写技能或语言证书。请先在“经历与成果”补充；不会自动添加未记录的证书。</p>}
      </div>
      <div className="section-heading"><h2>候选经历与草稿</h2><span>已勾选 {selected.length} 段（AI 每次最多 {AI_CANDIDATE_LIMIT} 段）</span>
        <button className="text-link" disabled={busy || outdated} onClick={() => update((previous) => ({ ...previous, selectedIds: selectAiCandidates(previous.results) }))}>重新勾选推荐候选</button></div>
      {!data.results.length && entries.some((item) => !item.deletedAt && item.type === '教育') && <p className="matching-note">当前没有可匹配的项目经历；已保存的教育经历仍可单独整理到简历。</p>}
      <p className="attachment-notice">“推荐候选”预留最多 4 个无关键词命中的名额，帮助发现可迁移经验。AI 每次最多评估 12 段；只有勾选的经历会发送。</p>
      {data.results.length > AI_CANDIDATE_LIMIT && <p className="matching-note">经历库共 {data.results.length} 段，当前只准备其中最多 12 段候选。可取消勾选并从下方其他经历中补选。</p>}
      {data.results.map((item) => <article className="card match-card" key={item.source.id}>
        <div className="match-title-row"><label className="match-select"><input type="checkbox" checked={data.selectedIds.includes(item.source.id)}
          disabled={busy || (!data.selectedIds.includes(item.source.id) && selected.length >= AI_CANDIDATE_LIMIT)}
          onChange={() => update((previous) => ({ ...previous, selectedIds: previous.selectedIds.includes(item.source.id) ? previous.selectedIds.filter((id) => id !== item.source.id) : previous.selectedIds.length >= AI_CANDIDATE_LIMIT ? previous.selectedIds : [...previous.selectedIds, item.source.id] }))} /><strong>{item.source.title}</strong></label>
          <div className="match-badges"><span className="score">命中 {countKeywordHits(item)}/{data.requirements.length} 项关键词</span>
            {item.assessment && <span className="score">{assessmentLabel[item.assessment.level]}</span>}</div></div>
        <p className="match-source">{item.source.type} · {item.source.period} · {item.hits.join('、') || '可手动补充'}</p>
        {item.assessment && <div className="match-assessment"><p>{item.assessment.reason}</p>{item.assessment.jobEvidence.map((quote, index) => <p className="matching-note" key={index}>对应招聘原句：{quote}</p>)}</div>}
        <label className="form-label" htmlFor={'draft-' + item.source.id}>{item.mode === 'ai' ? 'AI 中文草稿，请核对' : '本地整理草稿，可直接修改'}</label>
        <textarea id={'draft-' + item.source.id} rows={4} maxLength={5000} disabled={busy} value={item.draft}
          onChange={(event) => { const draft = event.currentTarget.value; update((previous) => ({ ...previous, results: previous.results.map((entry) => entry.source.id === item.source.id ? { ...entry, draft } : entry) })) }} />
        <details className="source-details"><summary>查看原始档案和匹配依据</summary><p>角色：{item.source.role || '未填写'}　·　技能：{item.source.skills.join('、') || '未填写'}</p>
          <p className="source-text">原始贡献：{item.source.summary || '未填写'}<br />原始成果：{item.source.outcome || '未填写'}</p>
          <ul>{item.evidence.map((text, index) => <li key={index}>{text}</li>)}</ul></details>
        <button className="text-link" disabled={busy} onClick={() => {
          if (item.draft !== item.originalDraft && !window.confirm('恢复这段经历的本地整理草稿？当前修改会被替换。')) return
          update((previous) => ({ ...previous, results: previous.results.map((entry) => entry.source.id === item.source.id ? { ...entry, draft: entry.originalDraft, mode: 'local' } : entry) }))
        }}>恢复本地草稿</button>
        {item.beforeAi && <button className="text-link" disabled={busy} onClick={() => {
          if (!window.confirm('撤销最近一次 AI 改写，恢复当时的草稿？此后对本段的修改会被替换。')) return
          update((previous) => ({ ...previous, results: previous.results.map((entry) => entry.source.id === item.source.id && entry.beforeAi
            ? { ...entry, ...entry.beforeAi, beforeAi: undefined } : entry) }))
        }}>撤销最近 AI 改写</button>}
      </article>)}
      {selected.length >= AI_CANDIDATE_LIMIT && <p className="matching-note">已达到单次评估上限；如需加入其他经历，请先取消勾选一段。</p>}
      {onGenerated && <p className="matching-note">继续编辑时自动将本次招聘信息、匹配结果和生成简历保存到历史，最多保留最近 30 条。{historyBlocked && '上一条历史尚未确认保存，请先重试或备份。'}</p>}
      <div className="button-row end-row"><button className="button primary" disabled={busy || historyBlocked || outdated || (!selected.length && !entries.some((item) => !item.deletedAt && item.type === '教育'))} onClick={useResume}>{selected.length ? '使用所选经历继续编辑' : '使用教育经历继续编辑'}　→</button></div>
    </div>}
  </section>
}
