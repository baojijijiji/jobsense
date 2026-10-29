import { useEffect, useState } from 'react'
import type { Theme } from './types'
import { defaultCustomThemePalettes, type CustomThemePalettes, type ThemePalette } from './workspaceSchema'
import { useAccountWorkspace } from './workspaceContext'

const THEME_KEY = 'career-archive-theme'
const THEME_COLOR_KEY = 'career-archive-theme-color'
const THEME_MODE_KEY = 'career-archive-theme-mode'
const THEME_PALETTE_KEY = 'career-archive-theme-palette'
const DEFAULT_CUSTOM_COLOR = '#82938A'
type CustomThemeMode = 'light' | 'dark'
type PaletteKey = keyof ThemePalette

function isTheme(value: string | null): value is Theme {
  return value === 'gold' || value === 'green' || value === 'blue' || value === 'dark' || value === 'custom'
}

function safeColor(value: string | null | undefined, fallback = DEFAULT_CUSTOM_COLOR): string {
  return value && /^#[\da-f]{6}$/iu.test(value) ? value : fallback
}

function readLocalPalettes(): CustomThemePalettes {
  try {
    const raw = localStorage.getItem(THEME_PALETTE_KEY)
    if (!raw) return defaultCustomThemePalettes(safeColor(localStorage.getItem(THEME_COLOR_KEY)))
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') throw new Error('invalid palette')
    const source = value as Partial<CustomThemePalettes>
    const fallback = defaultCustomThemePalettes(safeColor(localStorage.getItem(THEME_COLOR_KEY)))
    const valid = (palette: unknown, backup: ThemePalette): ThemePalette => {
      if (!palette || typeof palette !== 'object') return backup
      const item = palette as Partial<ThemePalette>
      return {
        background: safeColor(item.background, backup.background), card: safeColor(item.card, backup.card),
        text: safeColor(item.text, backup.text), border: safeColor(item.border, backup.border), accent: safeColor(item.accent, backup.accent),
      }
    }
    return { light: valid(source.light, fallback.light), dark: valid(source.dark, fallback.dark) }
  } catch { return defaultCustomThemePalettes() }
}

function readableInk(hex: string): string {
  const channels = hex.slice(1).match(/[\da-f]{2}/giu)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [0.44, 0.52, 0.42]
  const luminance = channels.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  return luminance > .42 ? '#20251F' : '#FFFEF8'
}

export function useTheme() {
  const { context, snapshot } = useAccountWorkspace()
  const [localTheme, setLocalTheme] = useState<Theme>(() => {
    try { const saved = localStorage.getItem(THEME_KEY); if (isTheme(saved)) return saved } catch { /* Appearance still uses defaults. */ }
    return 'gold'
  })
  const [localMode, setLocalMode] = useState<CustomThemeMode>(() => {
    try { return localStorage.getItem(THEME_MODE_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [localPalettes, setLocalPalettes] = useState<CustomThemePalettes>(readLocalPalettes)

  const preferences = snapshot.data.preferences
  const theme = context ? preferences.theme : localTheme
  const customMode = (context ? preferences.customThemeMode : localMode) === 'dark' ? 'dark' : 'light'
  const allPalettes = context ? preferences.customThemePalettes ?? defaultCustomThemePalettes(safeColor(preferences.customThemeColor)) : localPalettes
  const customPalette = allPalettes[customMode]
  const customColor = safeColor(customPalette.accent)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme === 'custom' ? `custom-${customMode}` : theme
    root.dataset.colorScheme = theme === 'dark' || (theme === 'custom' && customMode === 'dark') ? 'dark' : 'light'
    root.style.setProperty('--custom-palette-accent', customPalette.accent)
    root.style.setProperty('--custom-palette-background', customPalette.background)
    root.style.setProperty('--custom-palette-card', customPalette.card)
    root.style.setProperty('--custom-palette-text', customPalette.text)
    root.style.setProperty('--custom-palette-border', customPalette.border)
    root.style.setProperty('--custom-accent', customColor)
    root.style.setProperty('--custom-accent-ink', readableInk(customColor))
    if (!context) {
      try {
        localStorage.setItem(THEME_KEY, theme)
        localStorage.setItem(THEME_COLOR_KEY, customColor)
        localStorage.setItem(THEME_MODE_KEY, customMode)
        localStorage.setItem(THEME_PALETTE_KEY, JSON.stringify(localPalettes))
      } catch { /* Appearance remains usable. */ }
    }
  }, [theme, customColor, customMode, customPalette, localPalettes, context])

  function updatePreferences(patch: { theme?: Theme; customThemeColor?: string; customThemeMode?: CustomThemeMode; customThemePalettes?: CustomThemePalettes }) {
    if (context) context.store.update('preferences', { ...context.store.getSnapshot().data.preferences, ...patch })
  }

  const setTheme = (value: Theme) => { if (context) updatePreferences({ theme: value }); else setLocalTheme(value) }
  const setCustomPaletteColor = (key: PaletteKey, value: string) => {
    const next = safeColor(value, customPalette[key])
    const nextPalettes = { ...allPalettes, [customMode]: { ...customPalette, [key]: next } }
    if (context) updatePreferences({ customThemePalettes: nextPalettes, ...(key === 'accent' ? { customThemeColor: next } : {}) })
    else setLocalPalettes(nextPalettes)
  }
  const setCustomMode = (value: CustomThemeMode) => { if (context) updatePreferences({ customThemeMode: value }); else setLocalMode(value) }

  return [theme, setTheme, customColor, customMode, setCustomMode, customPalette, setCustomPaletteColor] as const
}
