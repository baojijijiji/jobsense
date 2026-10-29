import { useEffect, useState } from 'react'
import { TYPOGRAPHY_KEY, defaultTypography, fontFamily, resumeFontFamily, parseTypography, type TypographySettings, type TypographyTarget } from './typography'
import { useAccountWorkspace } from './workspaceContext'
import { validateDocument } from './workspaceSchema'

function loadTypography() {
  try {
    return parseTypography(window.localStorage.getItem(TYPOGRAPHY_KEY))
  } catch {
    return { ...defaultTypography }
  }
}

export function useTypography() {
  const { context, snapshot } = useAccountWorkspace()
  const [localSettings, setSettings] = useState(() => context ? { ...defaultTypography } : loadTypography())
  const settings = context ? snapshot.data.preferences.typography : localSettings
  const [storageNotice, setStorageNotice] = useState('')

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--ui-font', fontFamily(settings.uiFont))
    root.style.setProperty('--ui-text-scale', String(settings.uiScale))
    root.style.setProperty('--resume-font', resumeFontFamily(settings.resumeFont, settings.resumeLatinFont))
    root.style.setProperty('--resume-font-size', String(settings.resumeSize) + 'pt')
  }, [settings])

  useEffect(() => {
    if (context) return
    function onStorage(event: StorageEvent) {
      try {
        if (event.storageArea === window.localStorage && (event.key === TYPOGRAPHY_KEY || event.key === null)) {
          setSettings(loadTypography())
          setStorageNotice('')
        }
      } catch {
        // Reading preferences is optional; current selections remain usable.
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [context])

  function change(patch: Partial<TypographySettings>) {
    const next = parseTypography(JSON.stringify({ version: 1, settings: { ...settings, ...patch } }))
    if (context) {
      const preferences = validateDocument('preferences', { ...context.store.getSnapshot().data.preferences, typography: next })
      if (!context.store.update('preferences', preferences)) setStorageNotice('设置存在其他设备冲突，请先处理同步提示。')
      else setStorageNotice('')
      return
    }
    setSettings(next)
    try {
      window.localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify({ version: 1, settings: next }))
      setStorageNotice('')
    } catch {
      setStorageNotice('设置已在当前页面生效，但浏览器无法记住选择。请检查网站存储设置后重新选择。')
    }
  }

  function reset(target: TypographyTarget) {
    change(target === 'ui'
      ? { uiFont: defaultTypography.uiFont, uiScale: defaultTypography.uiScale }
      : { resumeFont: defaultTypography.resumeFont, resumeLatinFont: defaultTypography.resumeLatinFont, resumeSize: defaultTypography.resumeSize })
  }

  return { settings, change, reset, storageNotice }
}
