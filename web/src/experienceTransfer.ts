import { ARCHIVE_KEY, ArchiveError, readArchive } from './experienceArchive'
import type { Experience } from './types'

const transferFormat = 'jobsense-experience-transfer'

export function downloadLocalExperienceTransfer() {
  let stored: string | null
  try { stored = window.localStorage.getItem(ARCHIVE_KEY) }
  catch { throw new Error('无法读取当前网址的本机经历资料。') }
  if (stored === null) throw new Error('当前网址没有已保存的个人经历；页面中的内置示例不会导出。请用保存旧资料时的同一个网址打开。')
  const snapshot = readArchive({ getItem: (key) => key === ARCHIVE_KEY ? stored : null, setItem: () => undefined })
  if (!snapshot.entries.length) throw new Error('当前网址的经历库为空，没有可导出的经历。')
  const contents = JSON.stringify({ format: transferFormat, version: 1, exportedAt: new Date().toISOString(), archive: snapshot }, null, 2)
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `JobSense-经历迁移-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return snapshot.entries.length
}

export function parseExperienceTransfer(contents: string): Experience[] {
  if (contents.length > 15 * 1024 * 1024) throw new Error('迁移文件超过 15 MiB，已停止读取。')
  let value: unknown
  try { value = JSON.parse(contents) } catch { throw new Error('文件不是有效的 JobSense 经历迁移 JSON。') }
  if (!value || typeof value !== 'object') throw new Error('迁移文件格式不受支持。')
  const envelope = value as Record<string, unknown>
  if (envelope.format !== transferFormat || envelope.version !== 1 || !envelope.archive || typeof envelope.archive !== 'object') {
    throw new Error('文件版本不受支持；请从旧版 JobSense 的“经历与成果”导出迁移文件。')
  }
  const archive = envelope.archive as Record<string, unknown>
  if (!Array.isArray(archive.entries) || archive.entries.length > 1000) throw new Error('迁移文件经历数量超出支持范围。')
  try {
    const validated = readArchive({ getItem: (key) => key === ARCHIVE_KEY ? JSON.stringify({ schemaVersion: 1, revision: 0, entries: archive.entries }) : null,
      setItem: () => undefined })
    return validated.entries
  } catch (cause) {
    throw new Error(cause instanceof ArchiveError ? cause.message : '迁移文件内容无效，未导入任何资料。')
  }
}
