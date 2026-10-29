import { useCallback, useEffect, useState } from 'react'
import { applyApplicationMutation, ApplicationRecordError, readApplicationRecords, type ApplicationInput, type ApplicationRecord, type ApplicationSnapshot } from './applicationRecords'
import { useAccountWorkspace } from './workspaceContext'
import { validateDocument } from './workspaceSchema'

type MutationResult = { ok: true } | { ok: false; message: string }

function load() {
  try { return { snapshot: readApplicationRecords(window.localStorage), issue: '' } }
  catch (error) { return { snapshot: null, issue: error instanceof Error ? error.message : '无法读取本机投递记录。' } }
}

export function useApplicationRecords() {
  const { context, snapshot: workspace } = useAccountWorkspace()
  const [state, setState] = useState(() => context ? { snapshot: workspace.data.applications, issue: '' } : load())
  const reload = useCallback(() => {
    if (context) void context.reload().catch((cause) => setState((previous) => ({ ...previous, issue: cause instanceof Error ? cause.message : '读取失败。' })))
    else setState(load())
  }, [context])

  useEffect(() => {
    if (context) return
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === 'career-archive-applications-v1' || event.key === null)) reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [reload, context])

  function cloudMutation(command: Parameters<typeof applyApplicationMutation>[2]): MutationResult {
    if (!context) return { ok: false, message: '账号空间不可用。' }
    try {
      const current = context.store.getSnapshot().data.applications
      let raw = JSON.stringify(current)
      const next = applyApplicationMutation({ getItem: () => raw, setItem: (_, value) => { raw = value } }, current.revision, command)
      if (!context.store.update('applications', validateDocument('applications', next), 0)) return { ok: false, message: '投递记录存在其他设备冲突，请先处理顶部同步提示。' }
      setState((previous) => ({ ...previous, issue: '' })); return { ok: true }
    } catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : '投递修改失败。' } }
  }

  function save(input: ApplicationInput, editing?: ApplicationRecord): MutationResult {
    if (context) return cloudMutation({ kind: 'save', input, ...(editing ? { id: editing.id, expectedUpdatedAt: editing.updatedAt } : {}) })
    if (!state.snapshot) return { ok: false, message: state.issue || '投递记录不可用。' }
    try {
      const snapshot = applyApplicationMutation(window.localStorage, state.snapshot.revision,
        { kind: 'save', input, ...(editing ? { id: editing.id, expectedUpdatedAt: editing.updatedAt } : {}) })
      setState({ snapshot, issue: '' })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApplicationRecordError && error.code === 'conflict') reload()
      const message = error instanceof ApplicationRecordError ? error.message : '无法保存投递记录。'
      if (!(error instanceof ApplicationRecordError) || error.code === 'storage' || error.code === 'format') setState((previous) => ({ ...previous, issue: message }))
      return { ok: false, message }
    }
  }

  function remove(record: ApplicationRecord): MutationResult {
    if (context) return cloudMutation({ kind: 'delete', id: record.id })
    if (!state.snapshot) return { ok: false, message: state.issue || '投递记录不可用。' }
    try {
      const snapshot = applyApplicationMutation(window.localStorage, state.snapshot.revision, { kind: 'delete', id: record.id })
      setState({ snapshot, issue: '' })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApplicationRecordError && error.code === 'conflict') reload()
      const message = error instanceof ApplicationRecordError ? error.message : '无法删除投递记录。'
      if (!(error instanceof ApplicationRecordError) || error.code === 'storage' || error.code === 'format') setState((previous) => ({ ...previous, issue: message }))
      return { ok: false, message }
    }
  }

  return { snapshot: context ? workspace.data.applications : state.snapshot as ApplicationSnapshot | null, issue: workspace.errors.applications || state.issue, reload, save, remove, cloudMode: Boolean(context) }
}
