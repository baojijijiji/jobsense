import { educationPerformance, resumeExperienceBody, sectionTitles } from './jobMatching.ts'
import type { Experience } from './types'

export const richSectionPrefix = '标题：'
export const resumeFonts = {
  'SimSun, serif': '宋体',
  'Microsoft YaHei, sans-serif': '微软雅黑',
  'KaiTi, STKaiti, "Kaiti SC", serif': '楷体',
  'FangSong, STFangsong, SimSun, serif': '仿宋',
  'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif': '黑体',
  'DengXian, "Microsoft YaHei", sans-serif': '等线',
  '"Source Han Serif SC", "Noto Serif CJK SC", SimSun, serif': '思源宋体',
  '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif': '思源黑体',
  '"Times New Roman", "Liberation Serif", serif': 'Times New Roman',
  'Arial, sans-serif': 'Arial',
  'Calibri, Carlito, sans-serif': 'Calibri',
  'Cambria, "Liberation Serif", serif': 'Cambria',
  'Georgia, serif': 'Georgia',
  'Garamond, "EB Garamond", serif': 'Garamond',
  '"Courier New", "Liberation Mono", monospace': 'Courier New',
} as const
export type ResumeFont = keyof typeof resumeFonts
export const fontSizes = Array.from({ length: 17 }, (_, index) => index + 8)
export const lineSpacings = [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.65, 1.8, 2, 2.2]

function normalizeFontFamily(value: string) {
  return value.replace(/["']/g, '').replace(/\s+/g, ' ').toLowerCase().trim()
}

export function findResumeFont(value: string): ResumeFont | undefined {
  const normalized = normalizeFontFamily(value)
  const found = Object.keys(resumeFonts).find((font) => normalizeFontFamily(font) === normalized)
  if (found) return found as ResumeFont
  // Preserve rich text saved before the KaiTi fallback list was expanded.
  if (normalized === normalizeFontFamily('KaiTi, serif')) {
    return Object.keys(resumeFonts).find((font) => resumeFonts[font as ResumeFont] === '楷体') as ResumeFont | undefined
  }
  return undefined
}

export function plainToHtml(text: string) {
  return escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>')
}

const experienceSectionTitles = new Set(['教育经历', '科研经历', '项目经历', '实习经历', '校园实践'])

export function plainSectionToRichHtml(sectionTitle: string, text: string) {
  if (!experienceSectionTitles.has(sectionTitle) || !text.trim()) return plainToHtml(text)
  return text.replace(/\r\n?/g, '\n').split(/\n{2,}/).filter((block) => block.trim()).map((block) => {
    const [heading, ...details] = block.split('\n')
    const [projectName, ...metadata] = heading.split(/[ \t\u00a0\u3000]*\|[ \t\u00a0\u3000]*/u)
    const detailsLine = metadata.join('|')
    const headingParagraph = '<p>' + (projectName ? '<strong>' + escapeHtml(projectName) + '</strong>' : '')
      + (detailsLine ? (projectName ? '|' : '') + escapeHtml(detailsLine) : '') + '</p>'
    const detailText = details.join('\n')
    return headingParagraph + (detailText ? '<p>' + escapeHtml(detailText).replace(/\n/g, '<br>') + '</p>' : '')
  }).join('')
}

function boldProjectName(paragraph: HTMLParagraphElement, name: string) {
  const ownerDocument = paragraph.ownerDocument
  const walker = ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
  const parts: { node: Text; start: number; end: number }[] = []
  let remaining = name.length
  let started = false
  while (walker.nextNode() && remaining > 0) {
    const node = walker.currentNode as Text
    let start = 0
    if (!started) {
      const firstText = node.data.search(/\S/)
      if (firstText < 0) continue
      start = firstText
      started = true
    }
    const end = Math.min(node.data.length, start + remaining)
    if (end <= start) continue
    parts.push({ node, start, end })
    remaining -= end - start
  }
  if (remaining || !parts.length) return
  const alreadyBold = parts.every(({ node }) => node.parentElement?.closest('strong, b'))
  const explicitlyRegular = parts.some(({ node }) => {
    let parent = node.parentElement
    while (parent && parent !== paragraph) {
      if (parent instanceof HTMLSpanElement && parent.style.fontWeight === '400') return true
      parent = parent.parentElement
    }
    return false
  })
  if (alreadyBold || explicitlyRegular) return

  const range = ownerDocument.createRange()
  const first = parts[0]
  const last = parts.at(-1)!
  range.setStart(first.node, first.start)
  range.setEnd(last.node, last.end)
  const strong = ownerDocument.createElement('strong')
  strong.append(range.extractContents())
  range.insertNode(strong)
}

function extractTextRange(container: HTMLElement, start: number, end: number) {
  const ownerDocument = container.ownerDocument
  const walker = ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let startNode: Text | null = null
  let endNode: Text | null = null
  let startOffset = 0
  let endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const nextOffset = offset + node.data.length
    if (!startNode && start >= offset && start <= nextOffset) { startNode = node; startOffset = start - offset }
    if (startNode && end >= offset && end <= nextOffset) { endNode = node; endOffset = end - offset; break }
    offset = nextOffset
  }
  if (!startNode || !endNode || end <= start) return ownerDocument.createDocumentFragment()
  const range = ownerDocument.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range.extractContents()
}

function alignLegacyEntryHeading(paragraph: HTMLParagraphElement) {
  paragraph.classList.add('resume-entry-heading')
  const existingMeta = paragraph.querySelector('.resume-entry-meta')
  if (existingMeta && /(?:19|20)\d{2}/u.test(existingMeta.textContent ?? '')) return
  const text = paragraph.textContent ?? ''
  const separators = [...text.matchAll(/[ \t\u00a0\u3000]*\|[ \t\u00a0\u3000]*/g)]
  const segments: { text: string; start: number }[] = []
  let segmentStart = 0
  for (const item of separators) {
    const index = item.index ?? segmentStart
    const raw = text.slice(segmentStart, index)
    segments.push({ text: raw.trim(), start: segmentStart + (raw.length - raw.trimStart().length) })
    segmentStart = index + item[0].length
  }
  const tail = text.slice(segmentStart)
  segments.push({ text: tail.trim(), start: segmentStart + (tail.length - tail.trimStart().length) })
  const datePattern = /(?:19|20)\d{2}(?:[./年-]\s*\d{1,2}月?)?/u
  const dateSegment = segments.find((segment, index) => index > 0 && datePattern.test(segment.text))
  const dateMatch = dateSegment && datePattern.exec(dateSegment.text)
  const dateStart = dateSegment && dateMatch ? dateSegment.start + dateMatch.index : -1
  const precedingSeparator = dateStart >= 0
    ? [...separators].reverse().find((item) => {
      const end = (item.index ?? 0) + item[0].length
      return end <= dateStart && !text.slice(end, dateStart).trim()
    })
    : undefined
  const fallbackSeparator = !existingMeta && dateStart < 0 ? separators.at(-1) : undefined
  const separator = precedingSeparator ?? fallbackSeparator
  let leftEnd = separator?.index ?? dateStart
  let rightStart = separator ? (separator.index ?? 0) + separator[0].length : dateStart
  if (leftEnd >= 0 && !separator) {
    while (leftEnd > 0 && /[ \t\u00a0\u3000]/u.test(text[leftEnd - 1])) leftEnd--
    while (rightStart < text.length && /[ \t\u00a0\u3000]/u.test(text[rightStart])) rightStart++
  }
  if (leftEnd < 0 || rightStart < 0 || rightStart >= text.length) return
  const metadata = extractTextRange(paragraph, rightStart, text.length)
  const titleAndOrganization = extractTextRange(paragraph, 0, leftEnd)
  const left = paragraph.ownerDocument.createElement('span')
  left.className = 'resume-entry-title'
  left.append(titleAndOrganization)
  const right = paragraph.ownerDocument.createElement('span')
  right.className = 'resume-entry-meta'
  right.append(metadata)
  paragraph.replaceChildren(left, right)
}

function stripBulletPrefix(item: HTMLLIElement) {
  const walker = item.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.data.trim()) continue
    node.data = node.data.replace(/^\s*[•·-]\s*/, '')
    return
  }
}

function paragraphToBullets(paragraph: HTMLParagraphElement) {
  const document = paragraph.ownerDocument
  const list = document.createElement('ul')
  list.className = 'resume-entry-bullets'
  for (const line of paragraph.innerHTML.split(/<br\s*\/?\s*>/iu)) {
    const safeLine = sanitizeResumeHtml(line)
    if (!safeLine.trim()) continue
    const check = new DOMParser().parseFromString(safeLine, 'text/html')
    if (!(check.body.textContent ?? '').trim()) continue
    const item = document.createElement('li')
    item.innerHTML = safeLine
    stripBulletPrefix(item)
    list.append(item)
  }
  if (list.childElementCount) paragraph.replaceWith(list)
}

function liftLegacyHeading(item: HTMLLIElement) {
  const paragraph = item.ownerDocument.createElement('p')
  paragraph.innerHTML = item.innerHTML
  const list = item.parentElement
  if (list && (list.tagName === 'UL' || list.tagName === 'OL')) {
    const parent = list.parentElement
    const listItems = [...list.children]
    const headingIndex = listItems.indexOf(item)
    const beforeItems = listItems.slice(0, headingIndex)
    const afterItems = listItems.slice(headingIndex + 1)
    const beforeList = beforeItems.length ? list.cloneNode(false) as HTMLOListElement | HTMLUListElement : undefined
    const afterList = afterItems.length ? list.cloneNode(false) as HTMLOListElement | HTMLUListElement : undefined
    beforeItems.forEach((entry) => beforeList?.append(entry))
    afterItems.forEach((entry) => afterList?.append(entry))
    if (parent) {
      if (beforeList) parent.insertBefore(beforeList, list)
      parent.insertBefore(paragraph, list)
      if (afterList) parent.insertBefore(afterList, list)
      list.remove()
    } else item.replaceWith(paragraph)
  } else item.replaceWith(paragraph)
  return paragraph
}

function isProjectHeadingBlock(block: HTMLElement) {
  const text = block.textContent ?? ''
  if (block.querySelector('br') || !/(?:19|20)\d{2}(?:[./年-]\s*\d{1,2}月?)?/u.test(text)) return false
  const hasMetadataMarker = text.includes('|') || Boolean(block.querySelector('.resume-entry-meta'))
  if (!hasMetadataMarker) return false
  if (block.classList.contains('resume-entry-heading') || block.querySelector('.resume-entry-title, .resume-entry-meta')) return true

  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.data.trim()) continue
    return Boolean(node.parentElement?.closest('strong, b'))
  }
  return false
}

export function resumeSectionHtml(sectionTitle: string, text: string, richValue?: string) {
  const hasRichContent = Boolean(richValue?.trim())
  const html = hasRichContent ? normalizeResumeRichSpacing(richValue!) : plainSectionToRichHtml(sectionTitle, normalizeMixedSpacing(text))
  if (!experienceSectionTitles.has(sectionTitle) || !text.trim()) return html

  const document = new DOMParser().parseFromString(html, 'text/html')
  const used = new Set<HTMLParagraphElement>()
  if (sectionTitle === '项目经历') {
    for (const paragraph of document.body.querySelectorAll('p')) {
      if (!isProjectHeadingBlock(paragraph)) continue
      alignLegacyEntryHeading(paragraph)
      used.add(paragraph)
    }
    for (const item of [...document.body.querySelectorAll('li')]) {
      if (!isProjectHeadingBlock(item)) continue
      const paragraph = liftLegacyHeading(item)
      alignLegacyEntryHeading(paragraph)
      used.add(paragraph)
    }
  }
  const paragraphs = [...document.body.querySelectorAll('p')]
  const headings = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).filter((block) => block.trim())
  for (const block of headings) {
    const heading = block.split('\n', 1)[0].trim()
    const name = heading.split(/[ \t\u00a0\u3000]*\|[ \t\u00a0\u3000]*/u, 1)[0].trim()
    if (!name) continue
    let paragraph = paragraphs.find((item) => !used.has(item) && (item.textContent ?? '').trimStart().startsWith(name))
    if (!paragraph) {
      const legacyItem = [...document.body.querySelectorAll('li')].find((item) => (item.textContent ?? '').trimStart().startsWith(name))
      if (legacyItem) paragraph = liftLegacyHeading(legacyItem)
    }
    if (!paragraph) continue
    used.add(paragraph)
    boldProjectName(paragraph, name)
    alignLegacyEntryHeading(paragraph)
  }
  for (const paragraph of paragraphs) if (!used.has(paragraph)) paragraphToBullets(paragraph)
  return sanitizeResumeHtml(document.body.innerHTML)
}

export function normalizeMixedSpacing(text: string) {
  return text
    .replace(/([\u3400-\u9fff])[ \t\u00a0\u3000]+(?=[A-Za-z0-9])/g, '$1')
    .replace(/([A-Za-z0-9+.#/%_-])[ \t\u00a0\u3000]+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/[ \t\u00a0\u3000]*\|[ \t\u00a0\u3000]*/g, '|')
}

export function normalizeResumeRichSpacing(value: string) {
  const compactSeparators = sanitizeResumeHtml(value).replace(/[ \t\u00a0\u3000]*\|[ \t\u00a0\u3000]*/g, '|')
  const document = new DOMParser().parseFromString(compactSeparators, 'text/html')
  for (const block of document.body.querySelectorAll('p, li')) {
    const runs: Text[][] = [[]]
    const collect = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { runs.at(-1)!.push(node as Text); return }
      if (node instanceof HTMLBRElement) { if (runs.at(-1)!.length) runs.push([]); return }
      for (const child of node.childNodes) collect(child)
    }
    collect(block)
    for (const run of runs) {
      const joined = run.map((node) => node.data).join('')
      const remove = new Set<number>()
      const spaces = /([\u3400-\u9fff])([ \t\u00a0\u3000]+)(?=[A-Za-z0-9])|([A-Za-z0-9+.#/%_-])([ \t\u00a0\u3000]+)(?=[\u3400-\u9fff])/g
      for (const match of joined.matchAll(spaces)) {
        const gapLength = match[2]?.length ?? match[4]?.length ?? 0
        const start = (match.index ?? 0) + (match[1]?.length ?? match[3]?.length ?? 0)
        for (let index = start; index < start + gapLength; index++) remove.add(index)
      }
      const separators = /[ \t\u00a0\u3000]*\|[ \t\u00a0\u3000]*/g
      for (const match of joined.matchAll(separators)) {
        const start = match.index ?? 0
        for (let index = start; index < start + match[0].length; index++) {
          if (joined[index] !== '|') remove.add(index)
        }
      }
      let offset = 0
      for (const node of run) {
        const originalLength = node.data.length
        let normalized = ''
        for (let index = 0; index < originalLength; index++) if (!remove.has(offset + index)) normalized += node.data[index]
        node.data = normalized
        offset += originalLength
      }
    }
  }
  return sanitizeResumeHtml(document.body.innerHTML)
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const safeTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'ul', 'ol', 'li'])

export function sanitizeResumeHtml(value: string) {
  const document = new DOMParser().parseFromString(value, 'text/html')
  function clean(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue ?? '')
    if (!(node instanceof Element)) return ''
    const tag = node.tagName.toLowerCase()
    const children = [...node.childNodes].map(clean).join('')
    if (tag === 'div' || /^h[1-6]$/.test(tag)) return '<p>' + children + '</p>'
    if (!safeTags.has(tag)) return children
    if (tag === 'br') return '<br>'
    let attrs = ''
    if (tag === 'p' && node.classList.contains('resume-entry-heading')) attrs = ' class="resume-entry-heading"'
    if (tag === 'ul' && node.classList.contains('resume-entry-bullets')) attrs = ' class="resume-entry-bullets"'
    if (tag === 'span') {
      const span = node as HTMLSpanElement
      const style: string[] = []
      if (span.classList.contains('resume-entry-title')) attrs = ' class="resume-entry-title"'
      if (span.classList.contains('resume-entry-meta')) attrs = ' class="resume-entry-meta"'
      const allowedFont = findResumeFont(span.style.fontFamily)
      if (allowedFont) style.push('font-family: ' + allowedFont)
      const size = span.style.fontSize
      if (/^(8|9|1\d|2[0-4])pt$/.test(size)) style.push('font-size: ' + size)
      const weight = span.style.fontWeight
      if (weight === '400' || weight === '700') style.push('font-weight: ' + weight)
      if (style.length) attrs += ' style="' + escapeHtml(style.join('; ')) + '"'
    }
    return '<' + tag + attrs + '>' + children + '</' + tag + '>'
  }
  return [...document.body.childNodes].map(clean).join('')
}

export function richHtmlToPlain(value: string) {
  const document = new DOMParser().parseFromString(sanitizeResumeHtml(value), 'text/html')
  document.body.querySelectorAll('br').forEach((node) => node.replaceWith(document.createTextNode('\n')))
  document.body.querySelectorAll('p,li').forEach((node) => node.append(document.createTextNode('\n')))
  return (document.body.textContent ?? '').replace(/\n+$/g, '')
}

export function validRichSections(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const values = Object.entries(value)
  return values.length <= sectionTitles.length * 2 && values.every(([key, content]) =>
    (sectionTitles.includes(key) || (key.startsWith(richSectionPrefix) && sectionTitles.includes(key.slice(richSectionPrefix.length))))
      && typeof content === 'string' && content.length <= 40000,
  )
}

export function makeExperienceRichSections(results: { source: { id: string; title: string; organization: string; role: string; period: string; location?: string; type: string; outcome: string }; draft: string }[], selectedIds: string[]) {
  const groupByType: Record<string, string> = { 科研: '科研经历', 项目: '项目经历', 实习: '实习经历', 实践: '校园实践' }
  const rich: Record<string, string> = {}
  for (const item of results.filter((entry) => selectedIds.includes(entry.source.id))) {
    const section = groupByType[item.source.type]
    if (!section) continue
    const leftMetadata = [item.source.organization, item.source.role].filter((value): value is string => Boolean(value))
    const left = (item.source.title ? '<strong>' + escapeHtml(item.source.title) + '</strong>' : '')
      + (item.source.title && leftMetadata.length ? '|' : '') + leftMetadata.map(escapeHtml).join('|')
    const rightMetadata = [item.source.period, item.source.location].filter((value): value is string => Boolean(value))
    const heading = '<p class="resume-entry-heading"><span class="resume-entry-title">' + left + '</span>'
      + (rightMetadata.length ? '<span class="resume-entry-meta">' + rightMetadata.map(escapeHtml).join('，') + '</span>' : '') + '</p>'
    const body = resumeExperienceBody(item.source.type, item.source.outcome, item.draft)
    const bullets = body.split(/\r?\n/u).map((line) => line.trim().replace(/^[•·-]\s*/u, '')).filter(Boolean)
      .map((line) => '<li>' + escapeHtml(normalizeMixedSpacing(line)) + '</li>').join('')
    rich[section] = (rich[section] ?? '') + heading + (bullets ? '<ul class="resume-entry-bullets">' + bullets + '</ul>' : '')
  }
  return rich
}

export function makeEducationRichSections(entries: Experience[]): Record<string, string> {
  const education = entries.filter((entry) => !entry.deletedAt && entry.type === '教育')
  const content = education.map((entry) => {
    const performance = educationPerformance(entry.summary) ? entry.summary : ''
    const right = [entry.period, entry.location].filter((value): value is string => Boolean(value))
    const heading = '<p class="resume-entry-heading"><span class="resume-entry-title">'
      + '<strong>' + escapeHtml(entry.title) + '</strong>'
      + [entry.organization, entry.role, performance].filter(Boolean).map((value) => '|' + escapeHtml(value)).join('')
      + '</span>' + (right.length ? '<span class="resume-entry-meta">' + right.map(escapeHtml).join('，') + '</span>' : '') + '</p>'
    const bullets = [
      entry.summary && !performance ? '学习方向：' + entry.summary : '',
      entry.skills.length ? '相关课程：' + entry.skills.join('|') : '',
      entry.outcome ? '获得荣誉：' + entry.outcome : '',
    ].filter(Boolean).map((line) => '<li>' + escapeHtml(normalizeMixedSpacing(line)) + '</li>').join('')
    return heading + (bullets ? '<ul class="resume-entry-bullets">' + bullets + '</ul>' : '')
  }).join('')
  return content ? { 教育经历: content } : {}
}
