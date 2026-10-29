import { useEffect, useState } from 'react'
import { DEFAULT_SKILLS_KEY, readDefaultSkills, validateDefaultSkills, writeDefaultSkills } from './resumeSkillPreferences'
import { useAccountWorkspace } from './workspaceContext'
import { validateDocument } from './workspaceSchema'

function loadLocalDefaults() {
  try { return { skills: readDefaultSkills(window.localStorage), error: '' } }
  catch { return { skills: [] as string[], error: '未能读取本机默认勾选，请重新设置；当前技能仍可手动选择。' } }
}

/** Account defaults use the account workspace; local preferences are never imported implicitly. */
export function useDefaultResumeSkills() {
  const { context, snapshot } = useAccountWorkspace()
  const [local, setLocal] = useState(() => context ? { skills: [] as string[], error: '' } : loadLocalDefaults())
  const [error, setError] = useState('')
  const defaults = context ? snapshot.data.preferences.defaultSkills ?? [] : local.skills

  useEffect(() => {
    if (context) return
    function onStorage(event: StorageEvent) {
      try {
        if (event.storageArea === window.localStorage && (event.key === DEFAULT_SKILLS_KEY || event.key === null)) setLocal(loadLocalDefaults())
      } catch { /* Existing selections remain usable when storage is unavailable. */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [context])

  function save(skills: string[]) {
    try {
      const next = validateDefaultSkills(skills)
      if (context) {
        const preferences = validateDocument('preferences', { ...context.store.getSnapshot().data.preferences, defaultSkills: next })
        if (!context.store.update('preferences', preferences)) throw new Error('默认勾选未保存，请先处理顶部的账号同步冲突。')
      } else {
        writeDefaultSkills(window.localStorage, next)
        setLocal({ skills: next, error: '' })
      }
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '默认勾选未能保存，请重试。')
      return false
    }
  }

  return { defaults, save, error: error || (!context ? local.error : ''), accountDefaults: !!context }
}
