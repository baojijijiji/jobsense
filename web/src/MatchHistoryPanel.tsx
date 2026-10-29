import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { HistoryRecord, HistorySnapshot, HistorySummary } from './matchHistory'
import { sectionTitles } from './jobMatching'
import { resumeSectionHtml, sanitizeResumeHtml } from './resumeFormatting'
import { resumeFontFamily } from './typography'
import { PixelIcon } from './PixelIcon'
import './MatchHistoryPanel.css'

interface Props {
  summaries: HistorySummary[]
  record: HistoryRecord | null
  loading: boolean
  busy: boolean
  restoring?: boolean
  error: string
  onSelect(id: string): void
  onRefresh(): void
  onClose(): void
  onRestore(record: HistoryRecord, variant: 'original' | 'current'): void
}

function displayTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Viewing a snapshot is read-only. Restoring is an explicit action handled by App. */
export function MatchHistoryPanel({ summaries, record, loading, busy, restoring = false, error, onSelect, onRefresh, onClose, onRestore }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [search, setSearch] = useState('')
  const matches = summaries.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    element?.showModal()
    closeButton.current?.focus()
    return () => {
      element?.close()
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') ?? [])]
      .filter((element) => element.getClientRects().length > 0)
    if (!controls.length) { event.preventDefault(); dialog.current?.focus(); return }
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <dialog ref={dialog} className="match-history-dialog" aria-labelledby="match-history-title" aria-describedby="match-history-description"
    onKeyDown={keepFocus} onCancel={(event) => { event.preventDefault(); if (!restoring) onClose() }}>
    <header className="match-history-heading">
      <div><h2 id="match-history-title"><PixelIcon name="archive" />岗位匹配历史<span>{summaries.length} / 30</span></h2>
        <p id="match-history-description">仅当前账号可查看。最多保留 30 条，新建记录超过上限时自动移除最早创建的一条。</p></div>
      <button ref={closeButton} type="button" className="button" disabled={restoring} onClick={onClose} aria-label="关闭岗位匹配历史">关闭</button>
    </header>
    {restoring && <p className="match-history-loading" role="status">正在备份当前简历并调阅历史，请稍候…</p>}
    {error && <div className="match-history-error" role="alert"><span>{error}</span><button type="button" className="button" disabled={loading || busy} onClick={onRefresh}>重新读取</button></div>}
    <div className="match-history-layout" aria-busy={loading || busy}>
      <aside className="match-history-sidebar" aria-label="历史记录列表">
        <div className="match-history-list-tools">
          <label htmlFor="match-history-search">查找历史岗位</label>
          <input id="match-history-search" type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="按记录名称查找" maxLength={160} />
          <button type="button" className="text-link" disabled={loading || busy} onClick={onRefresh}>刷新记录</button>
        </div>
        <ul className="match-history-list">
          {matches.map((item) => <li key={item.id}><button type="button" className={'match-history-item' + (record?.id === item.id ? ' selected' : '')}
            aria-current={record?.id === item.id ? 'true' : undefined} disabled={busy || loading} onClick={() => onSelect(item.id)}>
            <strong>{item.title || '未命名岗位'}</strong>
            <span>创建于 {displayTime(item.createdAt)}</span>
            <small>{item.version > 1 ? '已修改 · 初版仍保留' : '最初生成版本'}</small>
          </button></li>)}
        </ul>
        {!loading && !error && !matches.length && <p className="match-history-empty">{summaries.length ? '没有找到这个名称，可以换个关键词。' : '还没有历史记录。把岗位匹配结果整理到简历后，会在这里留存。'}</p>}
      </aside>
      <div className="match-history-detail" tabIndex={0} aria-label="历史记录详情">
        {loading && <p className="match-history-loading" role="status">正在读取历史记录…</p>}
        {record ? <HistoryDetail key={record.id} record={record} disabled={loading || busy} onRestore={onRestore} />
          : !loading && <div className="match-history-placeholder"><PixelIcon name="resume" /><h3>回到当时的岗位与简历</h3><p>选择一条记录，查看招聘原文、匹配依据和简历。浏览不会替换当前草稿。</p></div>}
      </div>
    </div>
  </dialog>
}

function HistoryDetail({ record, disabled, onRestore }: Pick<Props, 'onRestore'> & { record: HistoryRecord; disabled: boolean }) {
  const [variant, setVariant] = useState<'original' | 'current'>('current')
  const snapshot = record[variant]
  const draft = snapshot.draft
  const selected = draft.results.filter((item) => draft.selectedIds.includes(item.source.id))
  const relevance = { direct: '直接相关', transferable: '可迁移经验', weak: '关联较弱' }

  return <div className="match-history-record">
    <div className="match-history-record-heading"><div><h3>{record.title}</h3><p>创建 {displayTime(record.createdAt)} · 最近保存 {displayTime(record.updatedAt)}</p></div></div>
    <div className="match-history-version-row">
      <div className="match-history-versions" role="group" aria-label="选择历史版本">
        <button type="button" aria-pressed={variant === 'current'} className={variant === 'current' ? 'selected' : ''} onClick={() => setVariant('current')}>最近保存</button>
        <button type="button" aria-pressed={variant === 'original'} className={variant === 'original' ? 'selected' : ''} onClick={() => setVariant('original')}>最初生成</button>
      </div>
      <button type="button" className="button primary" disabled={disabled} onClick={() => onRestore(record, variant)}><PixelIcon name="resume" />{variant === 'original' ? '调阅初版并编辑' : '调阅并编辑'}</button>
    </div>
    <p className="match-history-note">{variant === 'original' ? '这是首次存入历史时的简历。后续修改会另存为“最近保存”，初版继续保留。' : '这是本条历史最近保存的内容。调阅后可继续修改，并保存回同一条记录。'}</p>
    <details className="match-history-section" open>
      <summary>岗位招聘信息</summary>
      <div className="match-history-job">{draft.matchedJob || draft.jobText || '该记录没有招聘文本。'}</div>
    </details>
    <details className="match-history-section">
      <summary>当时的匹配结果与依据 · 已选 {selected.length} 段经历</summary>
      <div className="match-history-evidence">
        {draft.aiFocus?.length ? <div><h4>岗位重点</h4><ul>{draft.aiFocus.map((item, index) => <li key={index}><strong>{item.label}</strong><blockquote>{item.quote}</blockquote></li>)}</ul></div> : null}
        {selected.map((item) => <article key={item.source.id}>
          <h4>{item.source.title}<span className="tag">{item.source.type}</span>{item.assessment && <span className="tag">{relevance[item.assessment.level]}</span>}</h4>
          <p className="match-history-note">{[item.source.organization, item.source.role, item.source.period].filter(Boolean).join(' · ')}</p>
          {item.assessment && <><p>{item.assessment.reason}</p>{item.assessment.jobEvidence.map((quote, index) => <blockquote key={index}>{quote}</blockquote>)}</>}
          {item.hits.length > 0 && <p>关键词命中：{item.hits.join('、')}</p>}
          <p className="match-history-draft">{item.draft}</p>
          {item.evidence.length > 0 && <details><summary>查看原文依据</summary><ul>{item.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul></details>}
        </article>)}
        {!selected.length && <p className="match-history-note">这条记录没有选中的项目经历，简历中仍可包含教育或手动编辑内容。</p>}
        <p className="match-history-note">这里保留存档时的来源与匹配结果；后来修改经历库，不会改写这份记录。</p>
      </div>
    </details>
    <div className="match-history-preview-heading"><h4>简历预览</h4><span>{variant === 'original' ? '最初生成' : '最近保存'} · 可调阅后编辑及导出</span></div>
    <HistoryResumePreview snapshot={snapshot} />
  </div>
}

function HistoryResumePreview({ snapshot }: { snapshot: HistorySnapshot }) {
  const draft = snapshot.draft
  const font = resumeFontFamily(snapshot.typography.resumeFont, snapshot.typography.resumeLatinFont)
  const style = { '--resume-font': font, '--resume-font-size': `${snapshot.typography.resumeSize}pt`, lineHeight: draft.lineSpacing ?? 1.65 } as CSSProperties
  return <div className="match-history-preview"><article className="resume-paper match-history-paper" style={style} aria-label="历史简历预览">
    <header className="resume-header"><div><h2>{draft.name || '未填写姓名'}</h2><p style={{ fontFamily: draft.contactFont || undefined, fontSize: (draft.contactSize ?? 12) + 'pt' }}>{draft.contact || '未填写联系方式'}</p></div>
      {snapshot.photoDataUrl ? <img className="resume-photo" src={snapshot.photoDataUrl} alt="存档时的简历照片" /> : <div className="resume-photo resume-photo-placeholder" aria-label="本记录无照片">无照片</div>}
    </header>
    {sectionTitles.map((title) => draft.visible[title] && <section className="resume-section" key={title}>
      <h3>{draft.sectionNames?.[title] ?? title}</h3>
      <div className="resume-text resume-rich-display" dangerouslySetInnerHTML={{ __html: sanitizeResumeHtml(resumeSectionHtml(title, draft.sections[title] ?? '', draft.richSections?.[title])) }} />
    </section>)}
  </article></div>
}
