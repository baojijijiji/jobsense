import { createContext, useContext, useSyncExternalStore } from 'react'
import { defaultWorkspace, type WorkspaceData } from './workspaceSchema'
import type { SyncSnapshot, WorkspaceSync } from './workspaceSync'

export interface WorkspaceContextValue { store: WorkspaceSync<WorkspaceData>; reload(): Promise<void>; recover(): Promise<void>; registerPhotoGuard(guard: (() => Promise<boolean>) | null): void; registerHistoryGuard(guard: (() => Promise<boolean>) | null): void }
export const AccountWorkspaceContext = createContext<WorkspaceContextValue | null>(null)
const empty: SyncSnapshot<WorkspaceData> = { data: defaultWorkspace(), versions: { applications: null, career: null, preferences: null }, pending: [], saving: [], errors: {}, conflicts: [] }
const getEmpty = () => empty
const subscribeEmpty = () => () => undefined
export function useAccountWorkspace() {
  const context = useContext(AccountWorkspaceContext)
  const snapshot = useSyncExternalStore(context?.store.subscribe ?? subscribeEmpty, context?.store.getSnapshot ?? getEmpty)
  return { context, snapshot }
}
