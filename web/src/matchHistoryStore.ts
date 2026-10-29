import type { HistoryRecord, HistorySnapshot, HistorySummary } from './matchHistory.ts'

export interface HistorySave {
  id: string
  title: string
  snapshot: HistorySnapshot
  expectedVersion: number | null
}
export interface HistoryRepository {
  list(signal: AbortSignal): Promise<HistorySummary[]>
  load(id: string, signal: AbortSignal): Promise<HistoryRecord>
  save(input: HistorySave, signal: AbortSignal): Promise<HistoryRecord>
}
export interface HistoryState {
  summaries: HistorySummary[]
  record: HistoryRecord | null
  loading: boolean
  busy: boolean
  error: string
  pending: HistorySave | null
}
export const emptyHistoryState: HistoryState = { summaries: [], record: null, loading: false, busy: false, error: '', pending: null }

/** Account-scoped in-memory queue. Never falls back to shared browser storage. */
export class MatchHistoryStore {
  private state: HistoryState = { ...emptyHistoryState }
  private listeners = new Set<() => void>()
  private controller = new AbortController()
  private readVersion = 0
  private active = true
  private repository: HistoryRepository
  constructor(repository: HistoryRepository) { this.repository = repository }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<HistoryState>) {
    if (!this.active) return
    this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener())
  }
  async refresh() {
    if (!this.active || this.state.busy) return
    const version = ++this.readVersion
    this.publish({ loading: true, error: this.state.pending ? this.state.error : '' })
    try {
      const summaries = await this.repository.list(this.controller.signal)
      if (this.active && version === this.readVersion) this.publish({ summaries,
        record: summaries.some((item) => item.id === this.state.record?.id) ? this.state.record : null })
    } catch (cause) {
      if (version === this.readVersion) this.publish({ error: cause instanceof Error ? cause.message : '历史记录暂时无法读取。' })
    } finally { if (version === this.readVersion) this.publish({ loading: false }) }
  }
  async select(id: string) {
    if (!this.active || this.state.busy) return
    const version = ++this.readVersion
    this.publish({ loading: true, record: null, error: this.state.pending ? this.state.error : '' })
    try {
      const record = await this.repository.load(id, this.controller.signal)
      if (this.active && version === this.readVersion) this.publish({ record })
    } catch (cause) {
      if (version === this.readVersion) this.publish({ error: cause instanceof Error ? cause.message : '这条历史暂时无法读取。' })
    } finally { if (version === this.readVersion) this.publish({ loading: false }) }
  }
  async save(input: HistorySave): Promise<HistoryRecord | null> {
    if (!this.active || this.state.busy || this.state.pending) return null
    // Freeze the submitted content even if the user keeps editing the workspace.
    this.publish({ pending: structuredClone(input) })
    return this.retry()
  }
  async retry(): Promise<HistoryRecord | null> {
    if (!this.active || this.state.busy || !this.state.pending) return null
    const input = this.state.pending
    ++this.readVersion
    this.publish({ busy: true, loading: false, error: '' })
    try {
      const record = await this.repository.save(input, this.controller.signal)
      if (!this.active) return null
      const { id, title, version, createdAt, updatedAt } = record
      const summaries = [{ id, title, version, createdAt, updatedAt }, ...this.state.summaries.filter((item) => item.id !== id)]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 30)
      this.publish({ record, summaries, pending: null, busy: false })
      return record
    } catch (cause) {
      this.publish({ busy: false, error: cause instanceof Error ? cause.message : '历史尚未确认保存，当前简历仍保留，请重试。' })
      return null
    }
  }
  /** Caller must explicitly back up/confirm before dropping a failed request. */
  discardPending() { if (!this.state.busy) this.publish({ pending: null, error: '' }) }
  dispose() { this.active = false; this.controller.abort(); this.listeners.clear() }
}
