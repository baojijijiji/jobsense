import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Account } from './cloudbaseAccount'
import { loadCloudDocuments, saveCloudDocument } from './cloudbaseDocuments'
import { AccountWorkspaceContext, useAccountWorkspace } from './workspaceContext'
import { WorkspaceSync } from './workspaceSync'
import type { WorkspaceData } from './workspaceSchema'
import { downloadTextTransfer, workspaceTransfer } from './textDataTransfer'

const names = { applications: '投递记录', career: '简历草稿', preferences: '个人设置' }
export function AccountWorkspace({ account, children, registerExitGuard }: { account: Account; children: ReactNode; registerExitGuard(guard: (() => Promise<boolean>) | null): void }) {
  const [store, setStore] = useState<WorkspaceSync<WorkspaceData> | null>(null)
  const current = useRef<WorkspaceSync<WorkspaceData> | null>(null)
  const photoGuard = useRef<(() => Promise<boolean>) | null>(null)
  const historyGuard = useRef<(() => Promise<boolean>) | null>(null)
  const registerHistoryGuard = useCallback((guard: (() => Promise<boolean>) | null) => { historyGuard.current = guard }, [])
  const registerPhotoGuard = useCallback((guard: (() => Promise<boolean>) | null) => { photoGuard.current = guard }, [])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); let active = true
    void loadCloudDocuments(account.id, controller.signal).then(({ data, versions }) => {
      if (!active) return
      const next = new WorkspaceSync(data, versions, (key, value, version, signal) => saveCloudDocument(account.id, key, value, version, signal))
      current.current = next; setStore(next); setError('')
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '无法读取账号文字资料。') })
    return () => { active = false; controller.abort(); current.current?.dispose(); current.current = null }
  }, [account.id, attempt])
  useEffect(() => {
    if (!store) return
    registerExitGuard(async () => {
      if (photoGuard.current && !(await photoGuard.current())) return false
      if (historyGuard.current && !(await historyGuard.current())) return false
      try { await store.flush(); return true }
      catch {
        if (!window.confirm('有修改尚未同步。要先下载当前文字资料备份，再退出账号吗？选择取消可以继续处理保存提示。')) return false
        downloadTextTransfer(workspaceTransfer(store.getSnapshot().data), 'JobSense-未同步文字备份'); return true
      }
    })
    return () => registerExitGuard(null)
  }, [store, registerExitGuard])
  async function reload(force = false) {
    const before = current.current
    if (!before) return
    if (!force && before.getSnapshot().pending.length) throw new Error('有修改尚未同步。请先重试保存，或导出备份后重新读取。')
    const loaded = await loadCloudDocuments(account.id, new AbortController().signal)
    if (current.current !== before) return
    if (!force && before.getSnapshot().pending.length) throw new Error('读取期间又有修改，已保留当前内容。')
    const next = new WorkspaceSync(loaded.data, loaded.versions, (key, value, version, signal) => saveCloudDocument(account.id, key, value, version, signal))
    before.dispose(); current.current = next; setStore(next)
  }
  async function recover() {
    if (current.current) downloadTextTransfer(workspaceTransfer(current.current.getSnapshot().data), 'JobSense-重新读取前文字备份')
    await reload(true)
  }
  if (!store) return <div className="cloud-access"><section className="cloud-access-card"><h1>账号文字资料</h1><p>{error || '正在读取投递记录、简历和设置……'}</p>{error && <button className="cloud-access-submit" onClick={() => { setError(''); setAttempt((value) => value + 1) }}>重新连接</button>}</section></div>
  return <AccountWorkspaceContext.Provider value={{ store, reload: () => reload(), recover, registerPhotoGuard, registerHistoryGuard }}><WorkspaceStatus />{children}</AccountWorkspaceContext.Provider>
}
function WorkspaceStatus() {
  const { context, snapshot } = useAccountWorkspace()
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    if (!snapshot.pending.length) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard)
  }, [snapshot.pending.length])
  const errors = Object.values(snapshot.errors).filter(Boolean)
  return <div className={'cloud-doc-sync ' + (errors.length ? 'sync-failed' : '')} role="status">
    <span>{errors.length ? '文字资料未同步' : snapshot.pending.length ? '正在保存文字资料……' : '投递、简历与设置已同步'}{snapshot.pending.length > 0 && ' · ' + snapshot.pending.map((key) => names[key]).join('、')}</span>
    {errors.length > 0 && <><span>{errors[0]}</span><button onClick={() => { setActionError(''); void context?.store.flush().catch((cause) => setActionError(cause instanceof Error ? cause.message : '保存失败。')) }} disabled={snapshot.saving.length > 0 || snapshot.conflicts.length > 0}>重试保存</button><button disabled={snapshot.saving.length > 0} onClick={() => { setActionError(''); void context?.recover().catch((cause) => setActionError(cause instanceof Error ? cause.message : '重新读取失败。')) }}>导出待保存资料并读取云端</button></>}
    <button onClick={() => downloadTextTransfer(workspaceTransfer(snapshot.data))}>备份文字资料</button>
    <button disabled={snapshot.pending.length > 0} onClick={() => { setActionError(''); void context?.reload().catch((cause) => setActionError(cause instanceof Error ? cause.message : '读取失败。')) }}>读取最新文字资料</button>
    {actionError && <span role="alert">{actionError}</span>}
  </div>
}
