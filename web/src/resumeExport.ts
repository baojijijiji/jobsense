/** Only explicit titles are used; job duties are never treated as a job name. */
export function suggestResumeJobTitle(jobText: string): string {
  const lines = jobText.split(/\r?\n/u).map((line) => line.trim().replace(/^#{1,6}\s*|^[•·]\s*/u, '')).filter(Boolean)
  for (const line of lines.slice(0, 12)) {
    const match = line.match(/^(?:(?:目标|应聘|招聘|求职)\s*)?(?:岗位|职位)(?:\s*名称)?\s*[:：]\s*(.+)$/u)
    const candidate = match?.[1]?.trim()
    if (candidate && candidate.length <= 80 && !/[。！？；;]/u.test(candidate)) return candidate
  }
  const first = lines[0] ?? ''
  if (first.length <= 60 && !/[。！？；;：:]/u.test(first) &&
      /(?:工程师|分析师|设计师|产品经理|产品助理|研究员|实习生|开发实习|数据分析|数据产品|产品开发|运营|助理|专员|经理|顾问|Engineer|Analyst|Designer|Manager|Intern)$/iu.test(first)) return first
  return ''
}

function filePart(value: string, maxLength: number): string {
  const printable = Array.from(value, (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character).join('')
  return Array.from(printable.replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '')).slice(0, maxLength).join('')
}

/** The browser appends .pdf when saving, so the print title excludes the extension. */
export function resumeFileBaseName(name: string, jobTitle: string): string {
  const person = filePart(name, 60) || '简历'
  const role = filePart(jobTitle.replace(/^[（(](.*)[）)]$/u, '$1'), 100)
  return role ? `${person}（${role}）` : person
}

/** Keep the suggested name for the entire print dialog, including nonblocking browsers. */
export function printResumeWithName(name: string, jobTitle: string): () => void {
  const previousTitle = document.title
  const printTitle = resumeFileBaseName(name, jobTitle)
  let active = true
  function restore() {
    if (!active) return
    active = false
    window.removeEventListener('afterprint', restore)
    if (document.title === printTitle) document.title = previousTitle
  }
  document.title = printTitle
  window.addEventListener('afterprint', restore)
  try { window.print() }
  catch (error) { restore(); throw error }
  return restore
}
