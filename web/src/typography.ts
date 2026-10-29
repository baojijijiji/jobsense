export type FontId = 'yahei' | 'songti' | 'kaiti' | 'fangsong' | 'heiti' | 'dengxian' | 'source-serif' | 'source-sans'
export type LatinFontId = 'times' | 'arial' | 'calibri' | 'cambria' | 'georgia' | 'garamond' | 'courier'
export type TypographyTarget = 'ui' | 'resume'
export interface TypographySettings {
  uiFont: FontId
  uiScale: number
  resumeFont: FontId
  resumeLatinFont: LatinFontId
  resumeSize: number
}

export const TYPOGRAPHY_KEY = 'career-archive-typography-v1'
export const fonts: { id: FontId; label: string; family: string }[] = [
  { id: 'yahei', label: '微软雅黑', family: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif' },
  { id: 'songti', label: '宋体', family: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif' },
  { id: 'kaiti', label: '楷体', family: '"KaiTi", "STKaiti", "Kaiti SC", serif' },
  { id: 'fangsong', label: '仿宋', family: '"FangSong", "STFangsong", "SimSun", serif' },
  { id: 'heiti', label: '黑体', family: '"SimHei", "Heiti SC", "Microsoft YaHei", sans-serif' },
  { id: 'dengxian', label: '等线', family: '"DengXian", "Microsoft YaHei", sans-serif' },
  { id: 'source-serif', label: '思源宋体', family: '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif' },
  { id: 'source-sans', label: '思源黑体', family: '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif' },
]
// No generic family here: CJK characters must fall through to the chosen Chinese font.
export const latinFonts: { id: LatinFontId; label: string; family: string }[] = [
  { id: 'times', label: 'Times New Roman', family: '"Times New Roman", "Liberation Serif", "Nimbus Roman"' },
  { id: 'arial', label: 'Arial', family: 'Arial, "Liberation Sans"' },
  { id: 'calibri', label: 'Calibri', family: 'Calibri, Carlito' },
  { id: 'cambria', label: 'Cambria', family: 'Cambria, "Liberation Serif"' },
  { id: 'georgia', label: 'Georgia', family: 'Georgia' },
  { id: 'garamond', label: 'Garamond', family: 'Garamond, "EB Garamond"' },
  { id: 'courier', label: 'Courier New', family: '"Courier New", "Liberation Mono"' },
]
export const uiSizes = [
  { value: 1, label: '标准（100%）' },
  { value: 1.15, label: '稍大（115%）' },
  { value: 1.3, label: '较大（130%）' },
  { value: 1.5, label: '特大（150%）' },
]
export const resumeSizes = [9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14]
export const defaultTypography: TypographySettings = { uiFont: 'yahei', uiScale: 1, resumeFont: 'songti', resumeLatinFont: 'times', resumeSize: 10.5 }

export function fontFamily(id: FontId) {
  return fonts.find((font) => font.id === id)?.family ?? fonts[0].family
}

export function resumeFontFamily(chinese: FontId, latin: LatinFontId) {
  const family = latinFonts.find((font) => font.id === latin)?.family ?? latinFonts[0].family
  return family + ', ' + fontFamily(chinese)
}

export function parseTypography(raw: string | null): TypographySettings {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
        !('settings' in value) || !value.settings || typeof value.settings !== 'object') return { ...defaultTypography }
    const settings = value.settings as Partial<TypographySettings>
    return {
      uiFont: fonts.some((font) => font.id === settings.uiFont) ? settings.uiFont! : defaultTypography.uiFont,
      uiScale: uiSizes.some((size) => size.value === settings.uiScale) ? settings.uiScale! : defaultTypography.uiScale,
      resumeFont: fonts.some((font) => font.id === settings.resumeFont) ? settings.resumeFont! : defaultTypography.resumeFont,
      resumeLatinFont: latinFonts.some((font) => font.id === settings.resumeLatinFont) ? settings.resumeLatinFont! : defaultTypography.resumeLatinFont,
      resumeSize: resumeSizes.includes(settings.resumeSize!) ? settings.resumeSize! : defaultTypography.resumeSize,
    }
  } catch {
    return { ...defaultTypography }
  }
}
