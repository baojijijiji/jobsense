import { useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { CloudAccountContext } from './cloudbaseContext'
import { AccountWorkspaceContext } from './workspaceContext'
import { MatchHistoryStore, emptyHistoryState } from './matchHistoryStore'

const emptySubscribe = () => () => undefined
const getEmpty = () => emptyHistoryState

export function useMatchHistory() {
  const account = useContext(CloudAccountContext)
  const registerGuard = useContext(AccountWorkspaceContext)?.registerHistoryGuard
  const owner = account?.id ?? ''
  const [handle, setHandle] = useState<{ owner: string; store: MatchHistoryStore } | null>(null)
  const store = handle?.owner === owner ? handle.store : null
  const state = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? getEmpty)
  useEffect(() => {
    if (!owner) return
    const repository = () => import('./cloudMatchHistory')
    const next = new MatchHistoryStore({
      list: async (signal) => (await repository()).listMatchHistory(owner, signal),
      load: async (id, signal) => (await repository()).loadMatchHistory(owner, id, signal),
      save: async (input, signal) => (await repository()).saveMatchHistory(owner, input, signal),
    })
    setHandle({ owner, store: next })
    return () => next.dispose()
  }, [owner])
  useEffect(() => {
    if (!store) return
    const guard = (event: BeforeUnloadEvent) => {
      if (store.getSnapshot().pending) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    registerGuard?.(async () => !store.getSnapshot().pending
      || window.confirm('历史记录尚未确认保存。请先重试或下载待保存记录；仍要退出账号吗？'))
    return () => { window.removeEventListener('beforeunload', guard); registerGuard?.(null) }
  }, [store, registerGuard])
  return { store, ...state }
}
