import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Experience } from './types'
import { attachmentKinds, attachmentMessage, changeAttachment, decodeAttachmentText, formatFileSize, listAttachments, readAttachment, saveAttachments, type Attachment } from './attachmentStore'

const PdfPreview = lazy(() => import('./PdfPreview'))

function relationLabel(item: Attachment, experiences: Experience[]): string {
  if (!item.experienceId) return '暂未关联经历'
  const experience = experiences.find((entry) => entry.id === item.experienceId)
  return experience ? experience.title + (experience.deletedAt ? '（经历在回收站）' : '') : '关联经历暂不可用'
}

export function AttachmentLibrary({ experiences }: { experiences: Experience[] }) {
  const [items, setItems] = useState<Attachment[]>([])
  const [loaded, setLoaded] = useState(false)
  const [issue, setIssue] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [notice, setNotice] = useState('')
  const [relation, setRelation] = useState('')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('全部')
  const [trash, setTrash] = useState(false)
  const [deleting, setDeleting] = useState<Attachment | null>(null)
  const [linking, setLinking] = useState<Attachment | null>(null)
  const [preview, setPreview] = useState<{ item: Attachment; blob: Blob } | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const active = experiences.filter((entry) => !entry.deletedAt)

  const reload = useCallback(async () => {
    const version = ++generation.current
    try {
      const rows = await listAttachments()
      if (mounted.current && version === generation.current) { setItems(rows); setLoaded(true); setIssue('') }
    } catch (error) {
      if (mounted.current && version === generation.current) { setIssue(attachmentMessage(error)); setLoaded(false) }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // eslint-disable-next-line react/set-state-in-effect -- Reload awaits IndexedDB; no synchronous render update.
    void reload()
    let connection: BroadcastChannel | null = null
    try {
      connection = new BroadcastChannel('career-archive-attachment-changes')
      connection.onmessage = () => { void reload() }
      channel.current = connection
    } catch { /* Focus reload works when BroadcastChannel is unavailable. */ }
    const focus = () => { void reload() }
    window.addEventListener('focus', focus)
    return () => { mounted.current = false; connection?.close(); channel.current = null; window.removeEventListener('focus', focus) }
  }, [reload])

  async function run(work: () => Promise<void>, success: string, after?: () => void) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setNotice('')
    try {
      await work()
      try { channel.current?.postMessage('changed') } catch { /* No file content is included in notifications. */ }
      if (mounted.current) { setNotice(success); after?.(); await reload() }
    } catch (error) {
      if (mounted.current) { setNotice(attachmentMessage(error)); await reload() }
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }

  function upload(files: File[]) {
    if (!files.length) return
    const experienceId = relation && active.some((entry) => entry.id === relation) ? relation : null
    if (relation && !experienceId) { setNotice('所选经历已不可用，请重新选择关联或暂不关联。'); return }
    void run(() => saveAttachments(files, experienceId), '已在当前浏览器保存 ' + files.length + ' 个文件。')
  }
  async function view(item: Attachment) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setNotice('')
    try {
      const saved = await readAttachment(item.id)
      if (mounted.current) setPreview(saved)
    } catch (error) { if (mounted.current) setNotice(attachmentMessage(error)) }
    finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  const terms = search.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
  const visible = items.filter((item) => Boolean(item.deletedAt) === trash && (kind === '全部' || kind === item.kind)
    && terms.every((term) => (item.name + ' ' + item.kind + ' ' + relationLabel(item, experiences)).normalize('NFKC').toLocaleLowerCase().includes(term)))
  const total = items.reduce((sum, item) => sum + item.size, 0)

  return <section className="page-content attachment-library" aria-busy={busy}>
    <div className="page-heading"><div><div className="eyebrow">DOCUMENTS & EVIDENCE</div><h1>附件资料</h1><p className="lead">保存项目文件与证明材料，随时查看并关联到经历。</p></div><span className="tag">当前浏览器保存</span></div>
    <div className="privacy-note">开发阶段请用示例文件。请保留原文件：清除网站数据或关闭隐私窗口可能丢失附件，多设备同步尚未接入。</div>
    {issue && <div className="storage-banner" role="alert"><span>{issue}</span><button className="button" onClick={() => { void reload() }} disabled={busy}>重新读取</button></div>}
    <div className="card upload-card">
      <div className="card-heading"><div><h2>添加文件</h2><p>PDF、MD、Word（DOC / DOCX）、TXT、PNG · 每个 ≤ 10 MiB · 每批 ≤ 10 个</p></div></div>
      <label className="form-label attachment-relation">关联到经历<select value={relation} onChange={(event) => setRelation(event.target.value)} disabled={busy || !loaded}><option value="">暂不关联，先保存文件</option>{active.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}{relation && !active.some((entry) => entry.id === relation) && <option value={relation} disabled>原关联经历已不可用，请重新选择</option>}</select></label>
      {!active.length && <p className="hint">目前没有可关联的经历。可以先保存附件，新增经历后再关联。</p>}
      <input ref={input} type="file" hidden accept=".pdf,.md,.doc,.docx,.txt,.png" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; upload(files) }} disabled={busy || !loaded} />
      <button className="upload-area attachment-upload" disabled={busy || !loaded} onClick={() => input.current?.click()}><span className="upload-icon">＋</span><strong>{busy ? '正在处理，请稍候…' : '选择文件并保存'}</strong><span>文件只保存在当前浏览器，不会发送到云端或 AI</span></button>
      <p className="hint">已占用 {formatFileSize(total)} / 100 MiB（含回收站）。本批若有文件不符合要求，整批不保存。</p>
    </div>
    {notice && <p className="attachment-notice" role="status">{notice}</p>}
    <div className="card">
      <div className="card-heading"><h2>文件列表</h2><span className="muted">{visible.length} 个文件</span></div>
      <div className="filter-row"><button className={'filter-chip ' + (!trash ? 'active' : '')} onClick={() => setTrash(false)}>我的附件 ({items.filter((item) => !item.deletedAt).length})</button><button className={'filter-chip ' + (trash ? 'active' : '')} onClick={() => setTrash(true)}>附件回收站 ({items.filter((item) => item.deletedAt).length})</button></div>
      <div className="attachment-filters"><label>搜索文件<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="文件名、类型或关联经历" /></label><label>文件类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="全部">全部类型</option>{attachmentKinds.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select></label></div>
      {loaded ? visible.length ? <div className="attachment-list">{visible.map((item) => <article className="attachment-row" key={item.id}>
        <span className="file-type">{item.kind.toUpperCase()}</span><div className="attachment-description"><h3>{item.name}</h3><p>{relationLabel(item, experiences)}</p><small>{formatFileSize(item.size)} · {trash ? '删除于 ' : '保存于 '}{new Date(trash ? item.deletedAt! : item.createdAt).toLocaleString('zh-CN')}</small><small>文字提取 / OCR 尚未处理</small></div>
        <div className="button-row attachment-actions"><button className="button" disabled={busy || !loaded} onClick={() => { void view(item) }} aria-label={'查看' + item.name}>查看 / 下载</button>{trash ? <button className="button" disabled={busy || !loaded} onClick={() => { void run(() => changeAttachment(item, { deleted: false }), '已恢复附件。') }} aria-label={'恢复' + item.name}>恢复</button> : <><button className="button" disabled={busy || !loaded} onClick={() => { setNotice(''); setLinking(item) }} aria-label={'关联' + item.name}>关联经历</button><button className="button danger" disabled={busy || !loaded} onClick={() => { setNotice(''); setDeleting(item) }} aria-label={'删除' + item.name}>删除</button></>}</div>
      </article>)}</div> : <div className="empty-state">{search || kind !== '全部' ? '没有符合筛选条件的文件。' : trash ? '回收站是空的。' : '还没有附件，选择文件即可保存。'}</div> : <div className="empty-state">{issue ? '读取失败，修复后请重新读取。' : '正在读取本机附件…'}</div>}
    </div>
    {deleting && <AttachmentDialog title="附件移入回收站？" onClose={() => { if (!busy) setDeleting(null) }}><p>“{deleting.name}”会从附件列表移出，原文件与关联保留，可在附件回收站恢复。回收站仍占用容量。</p><div className="button-row end-row"><button className="button" autoFocus disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className="button danger" disabled={busy || !loaded} onClick={() => { void run(() => changeAttachment(deleting, { deleted: true }), '已移入附件回收站。', () => setDeleting(null)) }}>移入回收站</button></div>{notice && <p role="status">{notice}</p>}</AttachmentDialog>}
    {linking && <LinkDialog item={linking} experiences={experiences} busy={busy || !loaded} notice={notice} onClose={() => { if (!busy) setLinking(null) }} onSave={(experienceId) => { void run(() => changeAttachment(linking, { experienceId }), '已保存附件关联。', () => setLinking(null)) }} />}
    {preview && <AttachmentPreview {...preview} onClose={() => setPreview(null)} />}
  </section>
}

function AttachmentDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return <dialog ref={dialog} className={'confirm-dialog attachment-dialog ' + (wide ? 'attachment-preview-dialog' : '')} aria-labelledby="attachment-dialog-title" onCancel={(event) => { event.preventDefault(); onClose() }}><div className="card-heading"><h2 id="attachment-dialog-title">{title}</h2><button className="button" onClick={onClose} aria-label="关闭附件窗口">关闭</button></div>{children}</dialog>
}
function LinkDialog({ item, experiences, busy, notice, onSave, onClose }: { item: Attachment; experiences: Experience[]; busy: boolean; notice: string; onSave(id: string | null): void; onClose(): void }) {
  const [id, setId] = useState(item.experienceId ?? '')
  const active = experiences.filter((entry) => !entry.deletedAt)
  const unavailable = id !== '' && !active.some((entry) => entry.id === id)
  return <AttachmentDialog title="关联经历" onClose={onClose}><p>{item.name}</p><label className="form-label attachment-relation">选择关联经历<select autoFocus value={id} onChange={(event) => setId(event.target.value)} disabled={busy}><option value="">暂不关联</option>{active.map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}{unavailable && <option value={id} disabled>{relationLabel(item, experiences)}</option>}</select></label>{unavailable && <p className="hint">请选择可用经历或暂不关联。</p>}<div className="button-row end-row"><button className="button primary" disabled={busy || unavailable} onClick={() => onSave(id || null)}>保存关联</button></div>{notice && <p role="status">{notice}</p>}</AttachmentDialog>
}
function AttachmentPreview({ item, blob, onClose }: { item: Attachment; blob: Blob; onClose(): void }) {
  const [url, setUrl] = useState('')
  const [text, setText] = useState('正在读取文字…')
  const [error, setError] = useState('')
  const [downloadNotice, setDownloadNotice] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    // eslint-disable-next-line react/set-state-in-effect -- Synchronize the view with this externally allocated URL; cleanup releases it.
    setUrl(objectUrl)
    let cancelled = false
    if (item.kind === 'txt' || item.kind === 'md') {
      void blob.arrayBuffer().then((bytes) => { const content = decodeAttachmentText(bytes); if (!cancelled) setText(content) }).catch(() => { if (!cancelled) setError('无法读取文字，请下载原文件后查看。') })
    }
    return () => { cancelled = true; URL.revokeObjectURL(objectUrl) }
  }, [blob, item.kind])
  return <AttachmentDialog title={item.name} wide onClose={onClose}><p className="hint">{formatFileSize(item.size)} · 原文件预览。文字提取与 OCR 将在下一步提供。</p><div className="attachment-preview">
    {error ? <p role="alert" className="inline-error">{error}</p> : item.kind === 'png' ? url && <img src={url} alt={item.name} onError={() => setError('图片无法显示，请检查原始 PNG 文件或下载查看。')} /> : item.kind === 'txt' || item.kind === 'md' ? <pre>{text}</pre> : item.kind === 'pdf' ? <Suspense fallback={<p className="hint">正在准备 PDF 阅读器…</p>}><PdfPreview blob={blob} /></Suspense> : <div className="empty-state">Word 文件请下载后使用 Word 或 WPS 打开。</div>}
  </div><div className="button-row end-row">{url && <a className="button primary attachment-download" href={url} download={item.name} onClick={() => setDownloadNotice('已请求浏览器下载，请检查下载列表或保存窗口；这个提示不代表文件已保存。若没有反应，当前浏览器可能限制了下载，请继续保留原始文件。')}>下载原文件</a>}<button className="button" onClick={onClose}>完成查看</button></div>{downloadNotice && <p className="hint" role="status">{downloadNotice}</p>}</AttachmentDialog>
}
