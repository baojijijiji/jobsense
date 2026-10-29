import { useCallback, useEffect, useRef, useState } from 'react'
import { ARCHIVE_KEY, ArchiveError, applyArchiveCommand, readArchive, type ArchiveCommand, type ArchiveSnapshot } from './experienceArchive'
import type { Experience } from './types'

export type MutationResult = { ok: true } | { ok: false; message: string }
export type ArchiveImportResult = { added: number; skipped: number }
const cloudMode = import.meta.env.VITE_CLOUDBASE_MODE === 'true'

function loadState(): { snapshot: ArchiveSnapshot | null; issue: string } {
  try {
    return { snapshot: readArchive(window.localStorage), issue: '' }
  } catch (error) {
    return { snapshot: null, issue: error instanceof ArchiveError ? error.message : '浏览器无法访问本机存储，请允许网站保存数据后重新读取。' }
  }
}

export function useExperienceArchive() {
  const [state, setState] = useState(() => cloudMode
    ? { snapshot: null as ArchiveSnapshot | null, issue: '正在读取账号经历……' }
    : loadState())
  const activeRequest = useRef<AbortController | null>(null)

  const reload = useCallback(() => {
    if (!cloudMode) { setState(loadState()); return }
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setState((previous) => ({ ...previous, issue: '正在读取账号经历……' }))
    void import('./cloudbaseExperiences').then(async (cloud) => {
      const accountId = await cloud.currentCloudAccountId()
      return cloud.loadCloudArchive(accountId, controller.signal)
    }).then((snapshot) => {
      if (!controller.signal.aborted) setState({ snapshot, issue: '' })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState((previous) => ({ ...previous,
        issue: cause instanceof Error ? cause.message : '无法读取云端经历，请重试。' }))
    })
  }, [])

  useEffect(() => {
    if (!cloudMode) return
    reload()
    return () => activeRequest.current?.abort()
  }, [reload])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      try {
        if (event.storageArea === window.localStorage && (event.key === ARCHIVE_KEY || event.key === null)) reload()
      } catch {
        reload()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [reload])

  const perform = useCallback((command: ArchiveCommand): MutationResult | Promise<MutationResult> => {
    if (cloudMode) {
      const snapshot = state.snapshot
      if (!snapshot) return Promise.resolve({ ok: false, message: '云端经历尚未读取完成，请稍后重试。' })
      return import('./cloudbaseExperiences').then(async (cloud) => {
        const accountId = await cloud.currentCloudAccountId()
        const next = await cloud.performCloudArchiveCommand(accountId, snapshot, command)
        setState({ snapshot: next, issue: '' })
        return { ok: true as const }
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '云端保存失败，请重试。'
        if (/已变化|更新后/u.test(message)) reload()
        setState((previous) => ({ ...previous, issue: message }))
        return { ok: false as const, message }
      })
    }
    try {
      const snapshot = applyArchiveCommand(window.localStorage, command)
      setState({ snapshot, issue: '' })
      return { ok: true }
    } catch (error) {
      const message = error instanceof ArchiveError ? error.message : '无法保存到本机，请检查浏览器存储设置后重试。'
      if (error instanceof ArchiveError && error.code === 'conflict') reload()
      if (error instanceof ArchiveError && error.code === 'format') setState({ snapshot: null, issue: message })
      if (!(error instanceof ArchiveError) || error.code === 'storage') {
        setState((previous) => ({ ...previous, issue: message }))
      }
      return { ok: false, message }
    }
  }, [reload, state.snapshot])

  const importEntries = useCallback(async (entries: Experience[]): Promise<ArchiveImportResult> => {
    if (!cloudMode) throw new Error('只有登录后的云端工作台可以导入旧经历。')
    const cloud = await import('./cloudbaseExperiences')
    const accountId = await cloud.currentCloudAccountId()
    try {
      const result = await cloud.importCloudExperiences(accountId, entries)
      const snapshot = await cloud.loadCloudArchive(accountId)
      setState({ snapshot, issue: '' })
      return result
    } catch (cause) {
      try { setState({ snapshot: await cloud.loadCloudArchive(accountId), issue: '' }) } catch { /* keep the last readable snapshot */ }
      throw cause
    }
  }, [])

  return { ...state, reload, perform, importEntries }
}
