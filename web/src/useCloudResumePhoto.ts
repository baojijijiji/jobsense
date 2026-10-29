import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Account } from './cloudbaseAccount'
import { AccountWorkspaceContext } from './workspaceContext'

interface Life {
  owner: string; controller: AbortController; version: number | null; loaded: boolean; loading: boolean; saving: boolean
  pending: { dataUrl: string; version: number | null } | null
}
interface State { owner: string; dataUrl: string; loaded: boolean; loading: boolean; saving: boolean; pending: boolean; error: string }

export function useCloudResumePhoto(account: Account | null) {
  const owner = account?.id ?? ''
  const registerPhotoGuard = useContext(AccountWorkspaceContext)?.registerPhotoGuard
  const life = useRef<Life | null>(null)
  const [state, setState] = useState<State>(() => ({ owner, dataUrl: '', loaded: !owner, loading: !!owner, saving: false, pending: false, error: '' }))
  const active = useCallback((item: Life) => life.current === item && !item.controller.signal.aborted, [])

  const read = useCallback(async (item: Life) => {
    try {
      const { loadCloudResumePhoto } = await import('./cloudResumePhoto')
      if (!active(item)) return
      const photo = await loadCloudResumePhoto(item.owner, item.controller.signal)
      if (!active(item)) return
      item.version = photo?.version ?? null; item.loaded = true
      setState({ owner: item.owner, dataUrl: photo?.dataUrl ?? '', loaded: true, loading: false, saving: false, pending: false, error: '' })
    } catch (error) {
      if (active(item)) setState((previous) => ({ ...previous, owner: item.owner, loading: false,
        error: error instanceof Error ? error.message : '无法读取账号照片。' }))
    } finally { item.loading = false }
  }, [active])

  useEffect(() => {
    if (!owner) return
    const item: Life = { owner, controller: new AbortController(), version: null, loaded: false, loading: true, saving: false, pending: null }
    life.current = item
    void Promise.resolve(item).then(read)
    return () => { item.controller.abort(); if (life.current === item) life.current = null }
  }, [owner, read])

  useEffect(() => {
    if (!registerPhotoGuard) return
    registerPhotoGuard(async () => {
      const item = life.current
      return !item || (!item.saving && !item.pending)
        || window.confirm('本次照片尚未确认保存。继续退出后，请重新登录核对照片，必要时重新上传。仍要退出吗？')
    })
    return () => registerPhotoGuard(null)
  }, [registerPhotoGuard])

  useEffect(() => {
    if (!owner) return
    const guard = (event: BeforeUnloadEvent) => {
      if (life.current?.saving || life.current?.pending) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [owner])

  async function commit(item: Life) {
    if (!item.pending) return false
    try {
      const { saveCloudResumePhoto } = await import('./cloudResumePhoto')
      if (!active(item)) return false
      const result = await saveCloudResumePhoto(item.owner, item.pending.dataUrl, item.pending.version, item.controller.signal)
      if (!active(item)) return false
      item.version = result.version; item.pending = null
      setState({ owner: item.owner, dataUrl: result.dataUrl, loaded: true, loading: false, saving: false, pending: false, error: '' })
      return true
    } catch (error) {
      if (active(item)) setState((previous) => ({ ...previous, saving: false, pending: true,
        error: error instanceof Error ? error.message : '照片尚未确认保存，请重试。' }))
      return false
    } finally { item.saving = false }
  }

  async function upload(file: File) {
    const item = life.current
    if (!item || !item.loaded || item.loading || item.saving || item.pending) return false
    item.saving = true
    setState((previous) => ({ ...previous, saving: true, error: '' }))
    try {
      const { prepareCloudResumePhoto } = await import('./cloudResumePhoto')
      if (!active(item)) return false
      const dataUrl = await prepareCloudResumePhoto(file)
      if (!active(item)) return false
      item.pending = { dataUrl, version: item.version }
      return await commit(item)
    } catch (error) {
      if (active(item)) setState((previous) => ({ ...previous, saving: false,
        error: error instanceof Error ? error.message : '照片处理失败，请重新选择。' }))
      return false
    } finally { item.saving = false }
  }

  async function retry() {
    const item = life.current
    if (!item?.pending || item.saving || item.loading) return false
    item.saving = true
    setState((previous) => ({ ...previous, saving: true, error: '' }))
    return commit(item)
  }

  async function reload() {
    const item = life.current
    if (!item || item.loading || item.saving) return
    if (item.pending && !window.confirm('重新读取会放弃本次尚未确认保存的照片，读取账号中的最新照片。继续？')) return
    item.pending = null; item.loading = true
    setState((previous) => ({ ...previous, loading: true, pending: false, error: '' }))
    await read(item)
  }

  return { ...(state.owner === owner ? state : { owner, dataUrl: '', loaded: false, loading: true, saving: false, pending: false, error: '' }), upload, retry, reload }
}
