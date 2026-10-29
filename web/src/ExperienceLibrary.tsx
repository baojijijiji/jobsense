import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Experience, ExperienceInput, ExperienceType } from './types'
import { experienceTypes, fieldLimits, searchExperiences, type ArchiveCommand } from './experienceArchive'
import type { MutationResult } from './useExperienceArchive'
import type { ArchiveImportResult } from './useExperienceArchive'
import { downloadLocalExperienceTransfer, parseExperienceTransfer } from './experienceTransfer'

interface LibraryProps {
  entries: Experience[]
  search: string
  blocked: boolean
  creating: boolean
  onCreatingChange(value: boolean): void
  onCommand(command: ArchiveCommand): MutationResult | Promise<MutationResult>
  onNotice(message: string): void
  cloudMode: boolean
  accountEmail: string
  onImport(entries: Experience[]): Promise<ArchiveImportResult>
}

export function ExperienceLibrary({ entries, search, blocked, creating, onCreatingChange, onCommand, onNotice, cloudMode, accountEmail, onImport }: LibraryProps) {
  const [filter, setFilter] = useState('全部')
  const [deleted, setDeleted] = useState(false)
  const [editing, setEditing] = useState<Experience | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Experience | null>(null)
  const [actionError, setActionError] = useState('')
  const [pendingImport, setPendingImport] = useState<{ entries: Experience[]; fileName: string } | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => searchExperiences(entries, search, filter, deleted), [entries, search, filter, deleted])
  const trashCount = entries.filter((item) => item.deletedAt).length
  const activeCount = entries.length - trashCount

  function closeForm() {
    onCreatingChange(false)
    setEditing(null)
  }

  function create() {
    setEditing(null)
    setDeleted(false)
    onCreatingChange(true)
  }

  async function save(input: ExperienceInput) {
    const result = await onCommand(editing
      ? { kind: 'update', id: editing.id, expectedUpdatedAt: editing.updatedAt, input }
      : { kind: 'create', id: crypto.randomUUID(), input })
    if (result.ok) {
      closeForm()
      setActionError('')
      onNotice(cloudMode ? '已保存到云端账号' : '已保存到当前浏览器')
    }
    return result
  }

  async function selectImport(file?: File) {
    if (!file) return
    setActionError('')
    try {
      const entries = parseExperienceTransfer(await file.text())
      setPendingImport({ entries, fileName: file.name })
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '无法读取迁移文件。') }
  }

  async function confirmImport() {
    if (!pendingImport || importBusy) return
    setImportBusy(true); setActionError('')
    try {
      const result = await onImport(pendingImport.entries)
      setPendingImport(null)
      onNotice(`迁移完成：新增 ${result.added} 条，已存在并跳过 ${result.skipped} 条`)
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : '迁移失败；本机原资料未删除。') }
    finally { setImportBusy(false) }
  }

  async function restore(item: Experience) {
    const result = await onCommand({ kind: 'restore', id: item.id, expectedUpdatedAt: item.updatedAt })
    setActionError(result.ok ? '' : result.message)
    if (result.ok) onNotice('已恢复，可在“全部经历”中查看')
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const result = await onCommand({ kind: 'trash', id: pendingDelete.id, expectedUpdatedAt: pendingDelete.updatedAt })
    if (result.ok) {
      setPendingDelete(null)
      setActionError('')
      onNotice('已移入回收站，可随时恢复')
    } else {
      setActionError(result.message)
      setPendingDelete(null)
    }
  }

  return <section className="page-content">
    <div className="page-heading">
      <div><div className="eyebrow">YOUR EXPERIENCE LIBRARY</div><h1>经历与成果</h1><p className="lead">记录你的职责、贡献与成果；{cloudMode ? '保存到当前登录账号，可在其他设备查看。' : '保存在当前浏览器。'}</p></div>
      <div className="heading-action"><div className="button-row">
        {cloudMode ? <><input ref={importInput} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void selectImport(file) }} />
          <button className="button" disabled={blocked || importBusy} onClick={() => importInput.current?.click()}>导入旧经历</button></>
          : <button className="button" onClick={() => { try { const count = downloadLocalExperienceTransfer(); onNotice(`已导出 ${count} 条经历到迁移文件`) } catch (cause) { setActionError(cause instanceof Error ? cause.message : '导出失败。') } }}>导出本机经历</button>}
        <button className="button primary" disabled={blocked} onClick={create}>＋ 新建经历</button>
      </div></div>
    </div>
    <div className="local-note">{cloudMode
      ? `当前账号：${accountEmail || '已登录'}。经历、投递、简历与设置按账号同步；顶部可导入投递与简历。附件和照片将在私有存储阶段迁移。`
      : '本机开发版 · 如果列表显示的是内置示例，示例不会导出。迁移时请用之前录入资料的同一个网址打开；导出文件只包含经历文字，不包含附件和照片。'}</div>
    {(creating || editing) && <ExperienceForm key={editing?.id ?? 'new'} experience={editing} blocked={blocked} onSave={save} onCancel={closeForm} />}
    <div className="library-tabs" aria-label="经历状态">
      <button className={'filter-chip ' + (!deleted ? 'active' : '')} aria-pressed={!deleted} onClick={() => setDeleted(false)}>全部经历 <span>{activeCount}</span></button>
      <button className={'filter-chip ' + (deleted ? 'active' : '')} aria-pressed={deleted} onClick={() => setDeleted(true)}>回收站 <span>{trashCount}</span></button>
    </div>
    <div className="filter-row" aria-label="经历类型">{['全部', ...experienceTypes].map((type) =>
      <button key={type} className={'filter-chip ' + (filter === type ? 'active' : '')} aria-pressed={filter === type} onClick={() => setFilter(type)}>{type}</button>)}</div>
    <div className="library-results" role="status">{deleted ? '回收站' : '经历库'} · 找到 {visible.length} 条{search.trim() && ' · 搜索：' + search.trim()}</div>
    {actionError && <div className="inline-error" role="alert">{actionError}</div>}
    <div className="experience-grid">{visible.map((item) =>
      <ExperienceCard key={item.id} experience={item} deleted={deleted} blocked={blocked}
        onEdit={() => { onCreatingChange(false); setEditing(item); setActionError('') }}
        onDelete={() => { setPendingDelete(item); setActionError('') }}
        onRestore={() => restore(item)} />)}</div>
    {!visible.length && <div className="card empty-state">
      {blocked ? '本机资料暂时无法读取，请处理上方提示。' : search.trim() || filter !== '全部'
        ? '没有匹配的经历。可以更换关键词或选择“全部”类型。'
        : deleted ? '回收站为空。删除的经历会保留在这里，方便恢复。' : '还没有经历，点击“新建经历”开始记录。'}
    </div>}
    {pendingImport && <ImportDialog entries={pendingImport.entries} fileName={pendingImport.fileName} accountEmail={accountEmail}
      busy={importBusy} onConfirm={() => void confirmImport()} onCancel={() => setPendingImport(null)} />}
    {pendingDelete && <DeleteDialog experience={pendingDelete} onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />}
  </section>
}

function ExperienceForm({ experience, blocked, onSave, onCancel }: {
  experience: Experience | null
  blocked: boolean
  onSave(input: ExperienceInput): MutationResult | Promise<MutationResult>
  onCancel(): void
}) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [type, setType] = useState<ExperienceType>(experience?.type ?? '项目')
  const education = type === '教育'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const form = new FormData(event.currentTarget)
    const value = (key: string) => String(form.get(key) ?? '')
    try {
      const result = await onSave({
        title: value('title'), type: value('type') as ExperienceInput['type'], period: value('period'),
        location: value('location'), organization: value('organization'), role: value('role'), summary: value('summary'), outcome: value('outcome'),
        skills: value('skills').split(/[,，;；、\n]+/u),
      })
      if (!result.ok) setError(result.message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setSaving(false) }
  }

  return <form className="card new-experience-form" onSubmit={submit} aria-label={experience ? '编辑经历' : '新建经历'}>
    <div className="card-heading"><h2>{experience ? '编辑经历' : '新建经历'}</h2><span className="muted">* 为必填项</span></div>
    <div className="form-grid">
      <label>{education ? '学校名称 *' : '经历名称 *'}<input autoFocus name="title" required maxLength={fieldLimits.title} defaultValue={experience?.title} placeholder={education ? '例如：XX大学' : '例如：校园节能分析项目'} /></label>
      <label>类型<select name="type" value={type} onChange={(event) => setType(event.currentTarget.value as ExperienceType)}>{experienceTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>{education ? '专业 / 院系' : '单位或团队'}<input name="organization" maxLength={fieldLimits.organization} defaultValue={experience?.organization} placeholder={education ? '例如：信息管理与信息系统' : '学校、课题组或公司'} /></label>
      <label>{education ? '学历 / 学位' : '我的职责'}<input name="role" maxLength={fieldLimits.role} defaultValue={experience?.role} placeholder={education ? '例如：本科 / 管理学学士' : '例如：项目成员、研究助理'} /></label>
      <label>{education ? '就读时间' : '时间'}<input name="period" maxLength={fieldLimits.period} defaultValue={experience?.period} placeholder={education ? '例如：2022.09 — 2026.06' : '例如：2024.03 — 2024.08'} /></label>
      <label>地点（选填）<input name="location" maxLength={fieldLimits.location} defaultValue={experience?.location ?? ''} placeholder="例如：上海" /></label>
      <label>{education ? '核心课程 / 技能与证书' : '技能与证书'}<input name="skills" defaultValue={experience?.skills.join('，')} placeholder={education ? '例如：统计学，数据库，CET-6' : '例如：Python，数据分析，CET-4'} /><small>技能和已取得的证书用逗号分隔；岗位匹配时可智能勾选相关项。</small></label>
      <label className="wide-field">{education ? '学习内容 / 方向' : '具体贡献'}{education ? '（选填）' : ' *'}<textarea name="summary" required={!education} maxLength={fieldLimits.summary} defaultValue={experience?.summary} rows={4} placeholder={education ? '可填写研究方向、成绩或排名；没有可留空。' : '记录你亲自完成的工作、采用的方法和承担的责任。'} /></label>
      <label className="wide-field">{education ? '荣誉与成果' : '成果与证明'}<textarea name="outcome" maxLength={fieldLimits.outcome} defaultValue={experience?.outcome} rows={3} placeholder={education ? '可填写奖学金、竞赛、论文等；没有可留空。' : '记录实际成果、指标、论文或证书。暂时没有可留空，不需要编造数字。'} /></label>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="button-row"><button className="button" type="button" disabled={saving} onClick={onCancel}>取消</button><button className="button primary" type="submit" disabled={blocked || saving}>{saving ? '正在保存…' : '保存经历'}</button></div>
  </form>
}

function ImportDialog({ entries, fileName, accountEmail, busy, onConfirm, onCancel }: {
  entries: Experience[]; fileName: string; accountEmail: string; busy: boolean; onConfirm(): void; onCancel(): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  const trashed = entries.filter((item) => item.deletedAt).length
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="import-title" onCancel={onCancel}>
    <h2 id="import-title">导入旧经历到账号？</h2>
    <p>文件：{fileName}</p>
    <p>目标账号：{accountEmail || '当前登录账号'}</p>
    <p>共 {entries.length} 条经历/教育，其中 {entries.length - trashed} 条正常记录、{trashed} 条回收站记录。</p>
    <p>相同编号的云端记录会保留并跳过，不覆盖云端内容。导入失败可重新选择文件继续；原本机资料和导出文件都不会删除。</p>
    <div className="button-row end-row"><button autoFocus className="button" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy ? '正在安全导入…' : '确认导入'}</button></div>
  </dialog>
}

function ExperienceCard({ experience, deleted, blocked, onEdit, onDelete, onRestore }: {
  experience: Experience
  deleted: boolean
  blocked: boolean
  onEdit(): void
  onDelete(): void
  onRestore(): void
}) {
  return <article className="card experience-card">
    <div className="experience-card-heading"><div><div className="section-label">{experience.type} · {experience.period || '时间待补充'}</div><h2>{experience.title}</h2></div><span className={'tag ' + (experience.type === '科研' ? 'blue' : '')}>{experience.type}</span></div>
    {(experience.organization || experience.role || experience.location) && <div className="experience-meta">{[experience.organization, experience.role, experience.location].filter(Boolean).join(' · ')}</div>}
    {experience.summary && <p className="experience-body">{experience.summary}</p>}
    {experience.outcome && <div className="experience-outcome"><strong>{experience.type === '教育' ? '荣誉与成果' : '成果与证明'}</strong><p>{experience.outcome}</p></div>}
    <div className="tag-row">{experience.skills.map((skill) => <span className="tag" key={skill}>{skill}</span>)}</div>
    <div className="experience-footer"><small>{deleted ? '移入回收站 ' : '更新于 '}{new Date(deleted ? experience.deletedAt! : experience.updatedAt).toLocaleDateString('zh-CN')}</small>
      <div className="button-row">{deleted
        ? <button className="button" disabled={blocked} onClick={onRestore} aria-label={'恢复' + experience.title}>恢复</button>
        : <><button className="button" disabled={blocked} onClick={onEdit} aria-label={'编辑' + experience.title}>编辑</button><button className="button danger" disabled={blocked} onClick={onDelete} aria-label={'删除' + experience.title}>删除</button></>}</div>
    </div>
  </article>
}

function DeleteDialog({ experience, onConfirm, onCancel }: { experience: Experience; onConfirm(): void; onCancel(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="delete-title" onCancel={onCancel}>
    <h2 id="delete-title">移入回收站？</h2>
    <p>“{experience.title}”将从经历库中移出。你可以在回收站恢复它。</p>
    <div className="button-row end-row"><button autoFocus className="button" onClick={onCancel}>取消</button><button className="button danger" onClick={onConfirm}>移入回收站</button></div>
  </dialog>
}
