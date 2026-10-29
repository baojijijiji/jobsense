export class WorkspaceConflict extends Error {}
export type Versions<T> = { [K in keyof T]: number | null }
export interface SyncSnapshot<T> { data: T; versions: Versions<T>; pending: (keyof T)[]; saving: (keyof T)[]; errors: Partial<Record<keyof T, string>>; conflicts: (keyof T)[] }
type Send<T> = <K extends keyof T>(key: K, value: T[K], version: number | null, signal: AbortSignal) => Promise<number>

/** Keeps unsaved edits in memory, serializes writes, and never resolves conflicts by overwriting. */
export class WorkspaceSync<T extends object> {
  private value: SyncSnapshot<T>
  private listeners = new Set<() => void>()
  private timers = new Map<keyof T, ReturnType<typeof setTimeout>>()
  private tasks = new Map<keyof T, Promise<void>>()
  private controller = new AbortController()
  private active = true
  private send: Send<T>
  constructor(data: T, versions: Versions<T>, send: Send<T>) {
    this.value = { data, versions, pending: [], saving: [], errors: {}, conflicts: [] }; this.send = send
  }
  getSnapshot = () => this.value
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private publish(patch: Partial<SyncSnapshot<T>>) {
    if (!this.active) return
    this.value = { ...this.value, ...patch }; this.listeners.forEach((listener) => listener())
  }
  update<K extends keyof T>(key: K, content: T[K], delay = 500) {
    if (!this.active || this.value.conflicts.includes(key)) return false
    this.publish({ data: { ...this.value.data, [key]: content }, pending: [...new Set([...this.value.pending, key])] })
    const old = this.timers.get(key); if (old) clearTimeout(old)
    // An error remains visible until an explicit retry; do not silently loop requests.
    if (!this.value.errors[key]) this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.flushKey(key).catch(() => undefined) }, delay))
    return true
  }
  async flushKey(key: keyof T): Promise<void> {
    if (!this.active) throw new Error('账号空间已关闭。')
    const timer = this.timers.get(key); if (timer) { clearTimeout(timer); this.timers.delete(key) }
    const running = this.tasks.get(key)
    if (running) { await running; if (this.active && this.value.pending.includes(key)) return this.flushKey(key); return }
    if (this.value.conflicts.includes(key)) throw new WorkspaceConflict(this.value.errors[key] || '云端资料已被其他设备修改。')
    if (!this.value.pending.includes(key)) return
    const work = (async () => {
      this.publish({ saving: [...this.value.saving, key], errors: { ...this.value.errors, [key]: undefined } })
      try {
        while (this.active && this.value.pending.includes(key)) {
          const sent = this.value.data[key]; const encoded = JSON.stringify(sent)
          const version = await this.send(key, sent, this.value.versions[key], this.controller.signal)
          if (!this.active) return
          this.publish({ versions: { ...this.value.versions, [key]: version },
            pending: JSON.stringify(this.value.data[key]) === encoded ? this.value.pending.filter((item) => item !== key) : this.value.pending })
        }
      } catch (cause) {
        if (!this.active) return
        const retryTimer = this.timers.get(key); if (retryTimer) { clearTimeout(retryTimer); this.timers.delete(key) }
        const conflict = cause instanceof WorkspaceConflict
        this.publish({ errors: { ...this.value.errors, [key]: cause instanceof Error ? cause.message : '云端保存失败。' },
          conflicts: conflict ? [...new Set([...this.value.conflicts, key])] : this.value.conflicts })
        throw cause
      } finally { this.tasks.delete(key); this.publish({ saving: this.value.saving.filter((item) => item !== key) }) }
    })()
    this.tasks.set(key, work)
    await work
  }
  async flush() { for (const key of [...this.value.pending]) await this.flushKey(key) }
  reset(data: T, versions: Versions<T>) {
    if (this.value.pending.length || this.tasks.size) throw new Error('还有未同步修改，不能直接重新读取。请先保存或导出。')
    this.publish({ data, versions, errors: {}, conflicts: [] })
  }
  dispose() {
    this.active = false; this.controller.abort(); this.timers.forEach(clearTimeout); this.timers.clear(); this.listeners.clear()
  }
}
