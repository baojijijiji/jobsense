import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import type { PageId, Theme } from './types'
import { sectionTitles } from './jobMatching'
import { JobMatcher } from './JobMatcher'
import { useCareerDraft } from './useCareerDraft'
import { richSectionPrefix, lineSpacings, fontSizes, resumeFonts, normalizeMixedSpacing, normalizeResumeRichSpacing, resumeSectionHtml, type ResumeFont } from './resumeFormatting'
import { loadResumePhoto, saveResumePhoto } from './resumePhotoStore'
import { useCloudResumePhoto } from './useCloudResumePhoto'
import { ResumeTextEditor } from './ResumeTextEditor'
import { ExperienceLibrary } from './ExperienceLibrary'
import { AttachmentLibrary } from './AttachmentLibrary'
import { useExperienceArchive } from './useExperienceArchive'
import { searchExperiences } from './experienceArchive'
import { useTypography } from './useTypography'
import { TypographyDialog, TypographyFields } from './TypographyControls'
import { ApplicationTracker } from './ApplicationTracker'
import { CloudAccountContext } from './cloudbaseContext'
import { useTheme } from './useTheme'
import { useAccountWorkspace } from './workspaceContext'
import { TextDataTransfer } from './TextTransferControl'
import { printResumeWithName, resumeFileBaseName, suggestResumeJobTitle } from './resumeExport'
import { HomeDashboard } from './HomeDashboard'
import { PixelIcon, type PixelIconName } from './PixelIcon'
import type { ThemePalette } from './workspaceSchema'
import type { CareerDraft } from './careerDraft'
import { useMatchHistory } from './useMatchHistory'
import { MatchHistoryPanel } from './MatchHistoryPanel'
import { makeHistoryTitle, normalizeHistorySnapshot, type HistoryRecord, type HistorySnapshot } from './matchHistory'
import { historyDraftIsAligned, reviseMatching } from './historyDraft'

const navigation: { id: PageId; label: string; icon: PixelIconName }[] = [
  { id: 'home', label: '总览', icon: 'home' },
  { id: 'archive', label: '经历与成果', icon: 'archive' },
  { id: 'files', label: '附件资料', icon: 'file' },
  { id: 'match', label: '岗位匹配', icon: 'search' },
  { id: 'applications', label: '投递记录', icon: 'applications' },
  { id: 'resume', label: '简历编辑', icon: 'resume' },
]

const themeNames: Record<Theme, string> = { gold: '暖灰香槟', green: '雾绿玻璃', blue: '银白雾蓝', dark: '石墨深色', custom: '自定义颜色' }

function App() {
  const cloudMode = import.meta.env.VITE_CLOUDBASE_MODE === 'true'
  const account = useContext(CloudAccountContext)
  const { context: workspaceContext, snapshot: workspace } = useAccountWorkspace()
  const [page, setPage] = useState<PageId>('home')
  const [theme, setTheme, customThemeColor, customThemeMode, setCustomThemeMode, customThemePalette, setCustomThemePaletteColor] = useTheme()
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [typographyOpen, setTypographyOpen] = useState(false)
  const typography = useTypography()
  const [search, setSearch] = useState('')
  const { snapshot, issue, reload, perform, importEntries } = useExperienceArchive()
  const experiences = useMemo(() => searchExperiences(snapshot?.entries ?? [], ''), [snapshot])
  const skillCount = new Set(experiences.flatMap((item) => item.skills.map((skill) => skill.toLocaleLowerCase()))).size
  const [creatingExperience, setCreatingExperience] = useState(false)
  const career = useCareerDraft()
  const history = useMatchHistory()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyNotice, setHistoryNotice] = useState('')
  const [historyActionError, setHistoryActionError] = useState('')
  const [historyRestoring, setHistoryRestoring] = useState(false)
  const [editingResume, setEditingResume] = useState(false)
  const [notice, setNotice] = useState('')
  const [resumePhoto, setResumePhoto] = useState<Blob | null>(null)
  const [resumePhotoUrl, setResumePhotoUrl] = useState('')
  const resumePhotoUrlRef = useRef<string | null>(null)
  const [resumePhotoBusy, setResumePhotoBusy] = useState(false)
  const [resumePhotoError, setResumePhotoError] = useState('')
  const cloudPhoto = useCloudResumePhoto(cloudMode ? account : null)
  const displayedPhotoUrl = career.data.resumePhotoSnapshot ?? (cloudMode ? cloudPhoto.dataUrl : resumePhotoUrl)
  const photoBusy = cloudMode ? cloudPhoto.loading || cloudPhoto.saving : resumePhotoBusy
  const photoError = cloudMode ? cloudPhoto.error : resumePhotoError
  const photoDisabled = photoBusy || (cloudMode && (!cloudPhoto.loaded || cloudPhoto.pending))
  const suggestedExportJobTitle = suggestResumeJobTitle(career.data.matchedJob)
  const exportJobTitle = career.data.target.trim() || suggestedExportJobTitle
  const exportFileName = resumeFileBaseName(career.data.name || '姓名', exportJobTitle || '岗位名称') + '.pdf'
  const restorePrintTitle = useRef<(() => void) | null>(null)

  function openHistory() { setHistoryOpen(true); void history.store?.refresh() }

  function snapshotForHistory(draft: CareerDraft): HistorySnapshot {
    if (!historyDraftIsAligned(draft)) {
      throw new Error('岗位匹配信息与当前简历不对应，请先在岗位匹配中整理到简历，再保存历史。')
    }
    if (draft.resumePhotoSnapshot === undefined && (!cloudPhoto.loaded || cloudPhoto.loading || cloudPhoto.pending)) {
      throw new Error('账号照片尚未读取或保存完成，请先处理照片提示后再保存历史。')
    }
    return normalizeHistorySnapshot({ draft, typography: typography.settings,
      photoDataUrl: draft.resumePhotoSnapshot ?? cloudPhoto.dataUrl })
  }

  function acceptHistorySave(record: HistoryRecord) {
    career.update((previous) => previous.historyId === record.id ? { ...previous, historyVersion: record.version } : previous)
    setHistoryActionError('')
    setHistoryNotice('本次内容已保存到历史；首次生成的版本仍保留。')
  }

  async function saveHistory(draft = career.data): Promise<HistoryRecord | null> {
    if (!history.store || history.store.getSnapshot().pending || history.store.getSnapshot().busy) return null
    try {
      const snapshot = snapshotForHistory(draft)
      const id = draft.historyId ?? crypto.randomUUID()
      if (!draft.historyId && !career.update((previous) => ({ ...previous, historyId: id, historyVersion: undefined }))) return null
      setHistoryNotice(''); setHistoryActionError('')
      const record = await history.store.save({ id, title: makeHistoryTitle(snapshot), snapshot, expectedVersion: draft.historyVersion ?? null })
      if (record) acceptHistorySave(record)
      return record
    } catch (cause) { setHistoryActionError(cause instanceof Error ? cause.message : '历史未保存，请稍后重试。'); return null }
  }

  async function retryHistory() {
    const record = await history.store?.retry()
    if (record) acceptHistorySave(record)
  }

  function backupPendingHistory(discard = false) {
    const pending = history.store?.getSnapshot().pending
    if (!pending) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'jobsense-pending-history', version: 1, ...pending }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'JobSense-待保存历史.json'; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    if (discard && window.confirm('确认备份已下载后，放弃本次历史保存请求？当前简历仍保留；多设备冲突请重新调阅后修改。')) {
      history.store?.discardPending()
      // A fresh save can be kept as a new record instead of silently overwriting a conflicting version.
      career.update((previous) => previous.historyId === pending.id ? { ...previous, historyId: undefined, historyVersion: undefined } : previous)
      setHistoryNotice('已取消待保存请求，当前简历可另存为新的历史。')
    }
  }

  async function restoreHistory(record: HistoryRecord, variant: 'original' | 'current') {
    if (history.pending || history.busy || historyRestoring) { setHistoryActionError('请先处理待保存的历史。'); return }
    const canBackup = historyDraftIsAligned(career.data)
    const chosen = structuredClone(record[variant])
    if (!window.confirm(canBackup
      ? '调阅将替换当前编辑区。会先将当前简历保存到历史，再载入所选版本；仅保留最近 30 条。继续？'
      : '调阅将载入当时的招聘信息、简历、字体和照片，替换当前尚未整理完成的岗位输入与编辑内容。继续？')) return
    if (workspace.conflicts.includes('career') || workspace.conflicts.includes('preferences')) { setHistoryActionError('当前资料存在多设备冲突，请先处理顶部同步提示。'); return }
    setHistoryRestoring(true); setHistoryActionError('')
    try {
      const saved = canBackup ? await saveHistory() : null
      if (canBackup && !saved) return
      await workspaceContext?.store.flush()
      // Backing up a different current resume may evict the selected oldest record.
      // Fetch it again and stop if removed, rather than restoring a stale editable link.
      const { loadMatchHistory } = await import('./cloudMatchHistory')
      if (!account) return
      const refreshed = await loadMatchHistory(account.id, record.id, new AbortController().signal)
      if (refreshed.version !== (saved?.id === record.id ? saved.version : record.version)) throw new Error('这条历史已在其他设备修改，请刷新列表并重新调阅。')
      const next = { ...chosen.draft, historyId: refreshed.id, historyVersion: refreshed.version,
        resumeJob: chosen.draft.matchedJob, resumePhotoSnapshot: chosen.photoDataUrl }
      if (!career.update(() => next)) return
      typography.change({ resumeFont: chosen.typography.resumeFont, resumeLatinFont: chosen.typography.resumeLatinFont, resumeSize: chosen.typography.resumeSize })
      setHistoryOpen(false); setPage('resume'); setEditingResume(true)
      setHistoryNotice('已调阅历史版本。修改后点击“保存修改到本条历史”；最初版本不变。')
    } catch (cause) { setHistoryActionError(cause instanceof Error ? cause.message : '调阅失败，当前资料已保留。') }
    finally { setHistoryRestoring(false) }
  }

  useEffect(() => () => { restorePrintTitle.current?.() }, [])

  useEffect(() => {
    if (cloudMode) return
    let active = true
    void loadResumePhoto().then((photo) => {
      if (!active || !photo) return
      const url = URL.createObjectURL(photo)
      resumePhotoUrlRef.current = url
      setResumePhoto(photo)
      setResumePhotoUrl(url)
    })
      .catch((error: unknown) => { if (active) setResumePhotoError(error instanceof Error ? error.message : '无法读取简历照片。') })
    return () => { active = false }
  }, [cloudMode])

  useEffect(() => {
    return () => { if (resumePhotoUrlRef.current) URL.revokeObjectURL(resumePhotoUrlRef.current) }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2300)
    return () => window.clearTimeout(timer)
  }, [notice])


  function printResume() {
    if (!career.data.generated) { setNotice('先从岗位匹配整理一份简历'); return }
    if (!career.data.name.trim() || !career.data.contact.trim()) { setNotice('请先补充姓名和联系方式'); setEditingResume(true); return }
    if (!exportJobTitle.trim()) {
      setNotice('请在右侧填写岗位名称，用于生成 PDF 文件名')
      document.getElementById('resume-export-job-title')?.focus()
      return
    }
    restorePrintTitle.current?.()
    try { restorePrintTitle.current = printResumeWithName(career.data.name, exportJobTitle) }
    catch { setNotice('打印窗口未能打开，请稍后重试') }
  }

  async function uploadResumePhoto(file: File) {
    if (cloudMode) { if (await cloudPhoto.upload(file)) { career.update((previous) => ({ ...previous, resumePhotoSnapshot: undefined })); setNotice('照片已保存到当前账号') } return }
    setResumePhotoBusy(true)
    setResumePhotoError('')
    try {
      const photo = await saveResumePhoto(file)
      if (resumePhotoUrlRef.current) URL.revokeObjectURL(resumePhotoUrlRef.current)
      const url = URL.createObjectURL(photo)
      resumePhotoUrlRef.current = url
      setResumePhoto(photo)
      setResumePhotoUrl(url)
      setNotice('一寸照片已保存在当前浏览器')
    } catch (error) {
      setResumePhotoError(error instanceof Error ? error.message : '照片保存失败，请重试。')
    } finally { setResumePhotoBusy(false) }
  }

  function autoFormatResume() {
    const saved = career.update((previous) => ({
      ...previous,
      name: normalizeMixedSpacing(previous.name),
      contact: normalizeMixedSpacing(previous.contact),
      sections: Object.fromEntries(Object.entries(previous.sections).map(([title, text]) => [title, normalizeMixedSpacing(text)])),
      sectionNames: Object.fromEntries(Object.entries(previous.sectionNames ?? {}).map(([title, text]) => [title, normalizeMixedSpacing(text)])),
      richSections: Object.fromEntries(Object.entries(previous.richSections ?? {}).map(([title, html]) => [title, normalizeResumeRichSpacing(html)])),
    }))
    if (saved) setNotice('已整理中英文与数字间距；项目要点和日期地点已按模板排版')
  }

  function renderPage() {
    if (page === 'archive') {
      return <ExperienceLibrary entries={snapshot?.entries ?? []} search={search} blocked={!snapshot}
        creating={creatingExperience} onCreatingChange={setCreatingExperience} onCommand={perform} onNotice={setNotice}
        cloudMode={cloudMode} accountEmail={account?.email ?? ''} onImport={importEntries} />
    }

    if (page === 'files') {
      if (cloudMode) return <section className="page-content"><PageHeading eyebrow="PRIVATE FILES" title="附件资料" description="附件的私有账号存储正在接入。" /><div className="card"><p>原附件保留在原浏览器。当前账号暂不读取浏览器共享附件；完成私有云存储配置后，可继续迁移。简历照片可在“简历编辑”中上传并保存到账号。</p></div></section>
      return <AttachmentLibrary experiences={snapshot?.entries ?? []} />
    }

    if (page === 'match') {
      return <JobMatcher entries={snapshot?.entries ?? []} data={career.data} update={(change) => career.update((previous) => reviseMatching(previous, change(previous)))}
        onHistory={cloudMode ? openHistory : undefined} onGenerated={cloudMode ? (draft) => { void saveHistory(draft) } : undefined}
        historyBlocked={cloudMode && (history.busy || !!history.pending || !history.store)}
        onResume={() => setPage('resume')} onArchive={() => { setPage('archive'); setCreatingExperience(true) }} onNotice={setNotice} />
    }

    if (page === 'applications') return <ApplicationTracker onNotice={setNotice} onConfigureAi={() => setPage('match')} />

    if (page === 'resume') {
      return (
        <section className="page-content">
          <PageHeading eyebrow="EDIT BEFORE EXPORT" title="简历编辑" description="检查岗位简历内容，调整栏目后再导出 PDF。" action={<div className="button-row">{cloudMode && <button className="button" onClick={openHistory}>调阅历史记录</button>}<button className="button" onClick={() => setEditingResume((value) => !value)}>{editingResume ? '完成修改' : '编辑文字'}</button><button className="button primary" onClick={printResume}>打印 / 另存 PDF</button></div>} />
          {cloudMode && <div className="card history-save-bar"><div><strong>{career.data.historyVersion ? '正在编辑历史简历' : '当前岗位简历'}</strong><p className="hint">文字继续自动同步到当前草稿；修改版需保存到历史。最初版本始终保留，每个账号最多 30 条。</p></div><button className="button primary" disabled={!career.data.generated || history.busy || !!history.pending || !history.store} onClick={() => { void saveHistory() }}>{history.busy ? '正在保存…' : career.data.historyVersion ? '保存修改到本条历史' : '保存当前到历史'}</button></div>}
          <div className="resume-layout">
            <div className="resume-preview-wrap"><article className="resume-paper" style={{ lineHeight: career.data.lineSpacing ?? 1.65 }}>
              <header className="resume-header"><div><h2>{career.data.name || '请填写姓名'}</h2><p style={{ fontFamily: career.data.contactFont || undefined, fontSize: career.data.contactSize + 'pt' }}>{career.data.contact || '请填写联系方式'}</p></div>
                {displayedPhotoUrl ? <img className="resume-photo" src={displayedPhotoUrl} alt="简历照片" /> : <div className="resume-photo resume-photo-placeholder" aria-label="一寸照片位置">一寸照片</div>}
              </header>
              {sectionTitles.map((title) => career.data.visible[title] && <section className="resume-section" key={title}><h3>
                {editingResume
                  ? <ResumeTextEditor label={title + '栏目标题'} multiline={false} value={career.data.sectionNames?.[title] ?? title}
                    richValue={career.data.richSections?.[richSectionPrefix + title]}
                    onChange={(text, rich) => career.update((previous) => ({ ...previous,
                      sectionNames: { ...previous.sectionNames, [title]: text },
                      richSections: { ...previous.richSections, [richSectionPrefix + title]: rich },
                    }))} />
                  : <span className="resume-heading-text">{career.data.sectionNames?.[title] ?? title}</span>}
              </h3>
                {editingResume
                  ? <ResumeTextEditor label={title + '内容'} value={career.data.sections[title] ?? ''} richValue={resumeSectionHtml(title, career.data.sections[title] ?? '', career.data.richSections?.[title])}
                    onChange={(text, rich) => career.update((previous) => ({ ...previous,
                      sections: { ...previous.sections, [title]: text },
                      richSections: { ...previous.richSections, [title]: rich },
                    }))} />
                  : career.data.richSections?.[title] || career.data.sections[title]
                    ? <div className="resume-text resume-rich-display" dangerouslySetInnerHTML={{ __html: resumeSectionHtml(title, career.data.sections[title] ?? '', career.data.richSections?.[title]) }} />
                    : <div className="resume-text">{career.data.sections[title]}</div>}
              </section>)}
            </article></div>
            <aside className="resume-side" tabIndex={0} aria-label="简历编辑设置，可独立滚动">
              <div className="resume-side-heading"><strong>编辑设置</strong><span>可独立滚动</span></div>
              {!career.data.generated && <div className="card"><p className="matching-note">先粘贴招聘信息并挑选经历，或添加档案。此处不再自动填入虚构个人信息。</p><button className="button primary" onClick={() => setPage('match')}>开始岗位匹配</button></div>}
              <div className="card resume-profile"><h2>个人信息</h2>{(['name', 'contact'] as const).map((field) => <label key={field}>{({ name: '姓名', contact: '联系方式' })[field]}<input maxLength={field === 'contact' ? 400 : 100} value={career.data[field]} onChange={(event) => { const text = event.currentTarget.value; career.update((previous) => ({ ...previous, [field]: text })) }} /></label>)}
                <label>联系方式字体<select value={career.data.contactFont} onChange={(event) => { const contactFont = event.currentTarget.value as ResumeFont | ''; career.update((previous) => ({ ...previous, contactFont })) }}>
                  <option value="">跟随简历字体</option>{Object.entries(resumeFonts).map(([font, name]) => <option value={font} key={font}>{name}</option>)}
                </select></label>
                <label>联系方式字号<select value={career.data.contactSize} onChange={(event) => { const contactSize = Number(event.currentTarget.value); career.update((previous) => ({ ...previous, contactSize })) }}>
                  {fontSizes.map((size) => <option key={size} value={size}>{size} pt</option>)}
                </select></label>
              </div>
              <div className="card"><h2>简历照片</h2><label className="resume-photo-upload" htmlFor="resume-photo-upload" aria-disabled={photoDisabled}>{(cloudMode ? !!displayedPhotoUrl : !!resumePhoto) ? '更换一寸照片' : '上传一寸照片'}</label>
                {career.data.resumePhotoSnapshot !== undefined && <p className="hint">当前使用历史照片，上传新照片后将用于这份简历；旧历史的最初版本仍保留。</p>}
                <input className="resume-photo-file" id="resume-photo-upload" type="file" accept="image/jpeg,image/png,image/webp" disabled={photoDisabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void uploadResumePhoto(file) }} />
                <p className="hint">支持 JPG、PNG、WebP，最多 5 MiB。{cloudMode ? '自动适配简历尺寸并保存到当前账号，同账号换设备可读取。请保留原图；照片不会发送给 AI。' : '照片仅保存在当前浏览器，不会发送给 AI；换设备后需重新上传。'}</p>
                {photoBusy && <p role="status">{cloudMode && cloudPhoto.loading ? '正在读取账号照片…' : '正在处理并保存照片…'}</p>}
                {photoError && <p className="inline-error" role="alert">{photoError}</p>}
                {cloudMode && cloudPhoto.pending && <><p className="hint">本次上传尚未确认保存，预览仍显示原照片。可重试保存，或重新读取账号中的照片。</p><button className="button primary" disabled={photoBusy} onClick={() => { void cloudPhoto.retry().then((saved) => { if (saved) { career.update((previous) => ({ ...previous, resumePhotoSnapshot: undefined })); setNotice('照片已保存到当前账号') } }) }}>重试保存照片</button></>}
                {cloudMode && <button className="button secondary" disabled={photoBusy} onClick={() => { void cloudPhoto.reload() }}>{cloudPhoto.pending ? '放弃待保存照片并读取云端' : '重新读取账号照片'}</button>}
              </div>
              <div className="card"><TypographyFields settings={typography.settings} change={typography.change} reset={typography.reset} target="resume" idPrefix="resume-sidebar" />
                {typography.storageNotice && <p className="inline-error" role="alert">{typography.storageNotice}</p>}
              </div>
              <div className="card"><h2>简历行距</h2><label className="line-spacing-setting" htmlFor="resume-line-spacing">统一调整所有栏目和正文</label>
                <select id="resume-line-spacing" value={career.data.lineSpacing ?? 1.65} onChange={(event) => { const value = Number(event.currentTarget.value); career.update((previous) => ({ ...previous, lineSpacing: value })) }}>
                  {lineSpacings.map((value) => <option key={value} value={value}>{value.toFixed(2).replace(/0$/, '')} 倍</option>)}
                </select>
                <p className="hint">1.0 倍最紧凑，可按 0.05 倍逐步调整至 1.5 倍。导出前查看文字是否拥挤。</p>
              </div>
              <div className="card"><h2>自动排版</h2><p className="hint">整理中英文与数字间距，压紧竖线分隔符，保留英文词组内部空格。文字仍可继续手动修改。</p><button className="button full-button" disabled={!career.data.generated} onClick={autoFormatResume}>自动整理排版</button></div>
              <div className="card"><div className="card-heading"><h2>简历栏目</h2><button className="text-link" onClick={() => career.update((previous) => ({ ...previous, visible: Object.fromEntries(sectionTitles.map((title) => [title, true])) }))}>恢复默认</button></div>
                {sectionTitles.map((title) => <label className="section-toggle" key={title}><input type="checkbox" checked={career.data.visible[title]} onChange={() => career.update((previous) => ({ ...previous, visible: { ...previous.visible, [title]: !previous.visible[title] } }))} />{title}</label>)}
                <p className="hint">栏目默认保留；可以隐藏不需要的内容。</p>
              </div>
              <div className="card resume-profile"><h2>导出文件名</h2>
                <label htmlFor="resume-export-job-title">岗位名称<input id="resume-export-job-title" maxLength={80} value={career.data.target} placeholder={suggestedExportJobTitle || '如：数据分析、AI 产品开发'} onChange={(event) => { const target = event.currentTarget.value; career.update((previous) => ({ ...previous, target })) }} /></label>
                <p className="hint">岗位名称用于文件命名，会随当前简历保存。留空时使用招聘文本中的明确岗位标题。</p>
                <p className="resume-export-filename" aria-live="polite">{exportFileName}</p>
              </div>
              <div className="card"><div className="card-heading"><h2>导出前检查</h2></div><ul className="check-list"><li>修改并核对个人信息</li><li>确认成果有资料依据</li><li>查看是否需要第二页</li></ul><button className="button primary full-button" onClick={printResume}>打印 / 另存 PDF</button></div>
            </aside>
          </div>
        </section>
      )
    }

    return <HomeDashboard experiences={experiences} skillCount={skillCount} draft={career.data}
      photoUrl={displayedPhotoUrl} cloudMode={cloudMode} typography={typography.settings} onNavigate={setPage}
      onCreateExperience={() => { setPage('archive'); setCreatingExperience(true) }} />
  }

  return (
    <div className="app-shell glass-app" data-page={page}>
      <aside className="sidebar">
        <div className="brand"><strong>JobSense</strong><span className="sr-only">项目档案与简历助手</span></div>
        <div className="nav-caption">工作台</div>
        <nav className="nav-list" aria-label="主导航">{navigation.map((item) => <button key={item.id} className={'nav-item ' + (page === item.id ? 'active' : '')} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><PixelIcon className="nav-icon" name={item.icon} />{item.label}{item.id === 'archive' && <span className="nav-count">{experiences.length.toString().padStart(2, '0')}</span>}</button>)}{cloudMode && <button className="nav-item nav-history" onClick={openHistory}><PixelIcon className="nav-icon" name="history" />调阅历史</button>}</nav>
        <div className="sidebar-bottom"><div className="sync-card"><div className="sync-title"><span className={'sync-dot ' + ((issue && !issue.startsWith('正在读取')) || (cloudMode && cloudPhoto.error) ? 'sync-error' : '')} />{cloudMode ? '账号空间' : '当前设备'} <span className="demo-label">{issue ? (issue.startsWith('正在读取') ? '连接中' : '需要处理') : cloudMode ? cloudPhoto.error ? '照片待处理' : cloudPhoto.saving || cloudPhoto.pending ? '照片保存中' : workspace.pending.length ? '文字保存中' : cloudPhoto.loading ? '照片读取中' : '云端已同步' : snapshot?.revision ? '本机已保存' : '本地示例'}</span></div><p>{cloudMode ? '经历、投递、简历、照片与设置跟随账号。\n附件私有同步准备中。' : '经历资料保存在当前浏览器\n可通过导出入口迁移到账号。'}</p></div><div className="profile-mini"><span className="avatar">{account?.email?.slice(0, 1).toUpperCase() || '示'}</span><span><strong>{account?.email || career.data.name || '我的档案'}</strong><small>{cloudMode ? '个人空间 · CloudBase' : '个人空间 · 本地开发版'}</small></span></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="top-actions">
            <label className="search-control"><PixelIcon className="search-pixel-icon" name="search" /><input type="search" value={search} onChange={(event) => { setSearch(event.currentTarget.value); if (event.currentTarget.value) setPage('archive') }} placeholder="搜索经历、岗位或关键词" aria-label="搜索项目、技能或成果" /></label>
            {cloudMode && <button className="toolbar-history" aria-label="调阅历史记录" onClick={openHistory}><PixelIcon name="history" /><span>调阅历史</span></button>}
            <span className="toolbar-divider" aria-hidden="true" />
            <button className="theme-trigger typography-trigger" aria-haspopup="dialog" aria-expanded={typographyOpen} aria-label="文字设置：字体和大小" onClick={() => { setThemeMenuOpen(false); setTypographyOpen(true) }}><span aria-hidden="true">Aa</span></button>
            <button className="theme-mode-toggle" role="switch" aria-checked={theme === 'dark' || (theme === 'custom' && customThemeMode === 'dark')} aria-label="深色外观" onClick={() => { if (theme === 'custom') setCustomThemeMode(customThemeMode === 'dark' ? 'light' : 'dark'); else setTheme(theme === 'dark' ? 'gold' : 'dark') }}><PixelIcon name={theme === 'dark' || (theme === 'custom' && customThemeMode === 'dark') ? 'moon' : 'sun'} /><span className="theme-toggle-track" aria-hidden="true"><i /></span></button>
            <div className="theme-control"><button className="theme-trigger theme-palette-trigger" aria-haspopup="dialog" aria-controls="theme-settings" aria-expanded={themeMenuOpen} aria-label={'切换主题，当前为' + themeNames[theme]} onClick={() => setThemeMenuOpen((open) => !open)}><PixelIcon name="settings" /></button>
              {themeMenuOpen && <div className="theme-menu" id="theme-settings" role="dialog" aria-label="主题设置">
                <div className="theme-menu-heading"><strong>界面主题</strong><span>只改变工作台外观</span></div>
                {(['gold', 'green', 'blue', 'dark', 'custom'] as Theme[]).map((item) => <button key={item} className={'theme-option ' + (theme === item ? 'selected' : '')} aria-pressed={theme === item} onClick={() => { setTheme(item); if (item !== 'custom') setThemeMenuOpen(false) }}><span className={'theme-option-swatch ' + item} style={item === 'custom' ? { background: customThemeColor } : undefined} />{themeNames[item]}{theme === item && <span className="selected-mark">✓</span>}</button>)}
                {theme === 'custom' && <div className="theme-customizer">
                  <div className="theme-mode-picker" role="group" aria-label="自定义主题底色">
                    <button className={customThemeMode === 'light' ? 'selected' : ''} aria-pressed={customThemeMode === 'light'} onClick={() => setCustomThemeMode('light')}>浅色</button>
                    <button className={customThemeMode === 'dark' ? 'selected' : ''} aria-pressed={customThemeMode === 'dark'} onClick={() => setCustomThemeMode('dark')}>深色</button>
                  </div>
                  <div className="theme-palette-fields" aria-label="自定义整套主题色">
                    {([
                      ['background', '背景'], ['card', '卡片'], ['text', '文字'], ['border', '边框'], ['accent', '强调'],
                    ] as [keyof ThemePalette, string][]).map(([key, label]) => <label className="theme-color-picker" key={key}>{label}<input aria-label={`自定义${label}颜色`} type="color" value={customThemePalette[key]} onChange={(event) => setCustomThemePaletteColor(key, event.currentTarget.value)} /></label>)}
                  </div>
                </div>}
              </div>}
            </div>
            <details className="workspace-tools"><summary aria-label="账号与资料工具"><span className="toolbar-avatar">{account?.email?.slice(0, 1).toUpperCase() || career.data.name?.slice(0, 1) || 'J'}</span></summary><div className="workspace-tools-menu"><strong>{account?.email || '我的工作空间'}</strong><p>{cloudMode ? '账号资料与偏好同步' : '当前设备 · 本机资料'}</p><button className="theme-trigger workspace-typography" onClick={() => { setThemeMenuOpen(false); setTypographyOpen(true) }}>文字设置：字体和大小</button><TextDataTransfer onNotice={setNotice} /></div></details>
          </div>
        </header>
        {issue && !issue.startsWith('正在读取') && <div className="storage-banner" role="alert"><span>{issue}</span><button className="button" onClick={reload}>重新读取</button></div>}
        {career.error && <div className="storage-banner" role="alert"><span>{career.error}</span><button className="button" onClick={career.reload}>重新读取草稿</button></div>}
        {cloudMode && (history.pending || historyNotice || historyActionError) && <div className="storage-banner history-status" role={history.error || historyActionError ? 'alert' : 'status'}><span>{history.pending ? history.busy ? '正在将本次岗位与简历保存到历史…' : history.error || '历史尚未确认保存，当前简历仍保留。' : historyActionError || historyNotice}</span>{history.pending && !history.busy && <><button className="button" onClick={() => { void retryHistory() }}>重试保存历史</button><button className="button" onClick={() => backupPendingHistory()}>下载待保存记录</button><button className="text-link" onClick={() => backupPendingHistory(true)}>备份并取消本次保存</button></>}</div>}
        {renderPage()}
      </main>
      <nav className="mobile-nav" aria-label="手机导航">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><PixelIcon className="mobile-nav-icon" name={item.icon} />{item.id === 'archive' ? '经历' : item.id === 'files' ? '附件' : item.label}</button>)}</nav>
      {notice && <div className="toast" role="status">{notice}</div>}
      {typographyOpen && <TypographyDialog {...typography} onClose={() => setTypographyOpen(false)} />}
      {historyOpen && <MatchHistoryPanel summaries={history.summaries} record={history.record} loading={history.loading} busy={history.busy || historyRestoring || !!history.pending} restoring={historyRestoring}
        error={history.error || historyActionError} onClose={() => { if (!historyRestoring) setHistoryOpen(false) }} onRefresh={() => { setHistoryActionError(''); void history.store?.refresh() }} onSelect={(id) => { setHistoryActionError(''); void history.store?.select(id) }}
        onRestore={(record, variant) => { void restoreHistory(record, variant) }} />}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="lead">{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>
}

export default App
