import { useContext, useEffect, useRef, useState } from 'react'
import { CloudAccountContext } from './cloudbaseContext'
import { useAccountWorkspace } from './workspaceContext'
import { downloadTextTransfer, parseTextTransfer, readLocalTextTransfer, type TextTransfer } from './textDataTransfer'
import { mergeApplicationImport } from './workspaceSchema'

export function TextDataTransfer({ onNotice }: { onNotice(message: string): void }) {
  const account = useContext(CloudAccountContext); const { context } = useAccountWorkspace()
  const input = useRef<HTMLInputElement>(null); const dialog = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState<TextTransfer | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { const node = dialog.current; if (pending) node?.showModal(); return () => node?.close() }, [pending])
  async function select(file?: File) {
    if (!file) return
    setError('')
    try { if (file.size > 4_000_000) throw new Error('文件超过 4 MB。'); setPending(parseTextTransfer(await file.text())) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取迁移文件。') }
  }
  async function confirm() {
    if (!pending || !context || !account || busy) return
    setBusy(true); setError('')
    try {
      await context.store.flush()
      const { loadCloudDocuments } = await import('./cloudbaseDocuments')
      const remote = await loadCloudDocuments(account.id, new AbortController().signal)
      context.store.reset(remote.data, remote.versions)
      const changes: string[] = []
      if (pending.data.applications) {
        const merged = mergeApplicationImport(remote.data.applications, pending.data.applications)
        if (merged.added) { context.store.update('applications', merged.snapshot); await context.store.flushKey('applications') }
        changes.push(`投递新增 ${merged.added} 条、跳过 ${merged.skipped} 条`)
      }
      if (pending.data.career) {
        if (remote.versions.career === null) { context.store.update('career', pending.data.career); await context.store.flushKey('career'); changes.push('简历草稿已导入') }
        else changes.push('云端已有草稿，保留并跳过')
      }
      if (pending.data.preferences) {
        if (remote.versions.preferences === null) { context.store.update('preferences', pending.data.preferences); await context.store.flushKey('preferences'); changes.push('设置已导入') }
        else changes.push('云端已有设置，保留并跳过')
      }
      setPending(null); onNotice(changes.join('；'))
    } catch (cause) { setError((cause instanceof Error ? cause.message : '导入中断。') + ' 已完成部分保留；本机原件未删除，可重试同一文件。') }
    finally { setBusy(false) }
  }
  return <div className="text-transfer-control">
    <button className="theme-trigger migration-trigger" disabled={busy} onClick={() => {
      setError('')
      if (context) input.current?.click()
      else { try { const transfer = readLocalTextTransfer(); downloadTextTransfer(transfer); onNotice(`已导出 ${transfer.data.applications?.records.length ?? 0} 条投递及保存过的简历/设置`) } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败。') } }
    }}>{context ? '导入投递与简历' : '导出投递与简历'}</button>
    <input ref={input} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void select(file) }} />
    {error && !pending && <div className="transfer-error" role="alert">{error}</div>}
    {pending && <dialog ref={dialog} className="confirm-dialog" onCancel={(event) => { if (busy) event.preventDefault(); else setPending(null) }}>
      <h2>导入投递、简历与设置</h2><p>目标账号：{account?.email || '当前账号'}</p>
      <p>投递记录 {pending.data.applications?.records.length ?? 0} 条；{pending.data.career ? '包含完整简历草稿' : '没有简历草稿'}；{pending.data.preferences ? '包含主题和字体设置' : '没有设置'}。</p>
      <p>已有相同编号的投递保留；云端已有的草稿和设置也保留。此文件不包含附件、照片或已经导入的经历，原本机资料不会删除。</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="button-row end-row"><button className="button" disabled={busy} onClick={() => setPending(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void confirm()}>{busy ? '正在导入…' : '确认导入'}</button></div>
    </dialog>}
  </div>
}
