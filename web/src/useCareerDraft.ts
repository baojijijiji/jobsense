import { useCallback, useEffect, useRef, useState } from 'react'
import { CAREER_DRAFT_KEY as key, blankCareerDraft as blank, validCareerDraft as valid, type CareerDraft } from './careerDraft'
import { useAccountWorkspace } from './workspaceContext'
import { validateDocument } from './workspaceSchema'
export type { CareerDraft } from './careerDraft'
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function read() {
  const raw = localStorage.getItem(key)
  if (raw === null) return { revision: '', data: blank() }
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.revision !== 'string' || !valid(value.data)) throw new Error('草稿格式不可用，已保留原数据并暂停保存。')
  return { revision: value.revision, data: { ...blank(), ...value.data,
    richSections: value.data.richSections ?? {},
    sectionNames: { ...blank().sectionNames, ...value.data.sectionNames },
    lineSpacing: value.data.lineSpacing ?? 1.65,
    rewriteStyle: value.data.rewriteStyle ?? 'concise',
  } as CareerDraft }
}

export function useCareerDraft() {
  const { context, snapshot } = useAccountWorkspace()
  const [initial] = useState(() => {
    if (context) return { data: snapshot.data.career, revision: '', error: '' }
    try { return { ...read(), error: '' } } catch { return { data: blank(), revision: '', error: '无法读取岗位草稿，已保留原数据并暂停保存。' } }
  })
  const [data, setData] = useState(initial.data)
  const [error, setError] = useState(initial.error)
  const current = useRef({ data: initial.data, revision: initial.revision })
  const blocked = useRef(Boolean(initial.error))
  const reload = useCallback(() => {
    if (context) { void context.reload().then(() => setError('')).catch((cause) => setError(cause instanceof Error ? cause.message : '读取失败。')); return }
    try { const next = read(); current.current = next; setData(next.data); blocked.current = false; setError('') }
    catch { blocked.current = true; setError('无法读取岗位草稿，已保留原数据并暂停保存。') }
  }, [context])
  useEffect(() => {
    if (context) return
    const listener = (event: StorageEvent) => { if (event.key === key || event.key === null) reload() }
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  }, [context, reload])
  function update(change: (previous: CareerDraft) => CareerDraft) {
    if (context) {
      try {
        const next = validateDocument('career', change(context.store.getSnapshot().data.career))
        if (!context.store.update('career', next)) { setError('云端草稿存在冲突，请先导出待保存资料并重新读取。'); return false }
        setError(''); return true
      } catch (cause) { setError(cause instanceof Error ? cause.message : '草稿格式不可用。'); return false }
    }
    if (blocked.current) return false
    try {
      const latest = read()
      if (latest.revision !== current.current.revision) {
        current.current = latest; setData(latest.data)
        setError('另一页面已修改草稿，本次修改未保存。已载入最新内容，请重新操作。')
        return false
      }
      const next = { revision: crypto.randomUUID(), data: change(current.current.data) }
      const serialized = JSON.stringify({ schemaVersion: 1, ...next })
      if (serialized.length > 1_000_000) throw new Error('草稿过大')
      localStorage.setItem(key, serialized)
      current.current = next; setData(next.data); setError('')
      return true
    } catch {
      setError('草稿保存失败，本次修改未保存。请检查浏览器存储后重试。')
      return false
    }
  }
  return { data: context ? snapshot.data.career : data, update, error: error || snapshot.errors.career || '', reload }
}
