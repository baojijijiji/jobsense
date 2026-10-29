import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { findResumeFont, fontSizes, plainToHtml, resumeFonts, sanitizeResumeHtml, richHtmlToPlain, type ResumeFont } from './resumeFormatting'

interface Props { value: string; richValue?: string; label: string; multiline?: boolean; onChange: (plain: string, rich: string) => void }

export function ResumeTextEditor({ value, richValue, label, multiline = true, onChange }: Props) {
  const editor = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const [font, setFont] = useState<ResumeFont | ''>('')
  const [size, setSize] = useState('')
  const content = sanitizeResumeHtml(richValue ?? plainToHtml(value))

  useLayoutEffect(() => {
    const node = editor.current
    if (node && sanitizeResumeHtml(node.innerHTML) !== content) node.innerHTML = content
  }, [content])

  function rememberSelection() {
    const selection = window.getSelection()
    const node = editor.current
    if (!selection?.rangeCount || !node) return
    const range = selection.getRangeAt(0)
    if (!node.contains(range.commonAncestorContainer)) return
    savedRange.current = range.cloneRange()
    setHasSelection(!range.collapsed)
    const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    const styled = parent?.closest('span') as HTMLSpanElement | null
    if (styled) {
      const selectedFont = findResumeFont(styled.style.fontFamily)
      if (selectedFont) setFont(selectedFont as ResumeFont)
      const selectedSize = styled.style.fontSize.match(/^(8|9|1\d|2[0-4])pt$/)
      if (selectedSize) setSize(selectedSize[0].replace('pt', ''))
    }
  }

  function applyFormatting(setting: 'bold' | 'font' | 'size', newValue?: string) {
    const node = editor.current
    if (!node) return
    const selection = window.getSelection()
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!range || !node.contains(range.commonAncestorContainer) || range.collapsed) range = savedRange.current
    if (!range || !node.contains(range.commonAncestorContainer) || range.collapsed) return

    let makeBold = false
    if (setting === 'bold') {
      const parent = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const weight = parent ? Number.parseInt(window.getComputedStyle(parent).fontWeight, 10) : 400
      makeBold = !Number.isFinite(weight) || weight < 600
    }

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    const selected: { text: Text; start: number; end: number }[] = []
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      if (!text.data.length) continue
      if (!range.intersectsNode(text)) continue
      const start = range.startContainer === text ? range.startOffset : 0
      const end = range.endContainer === text ? range.endOffset : text.length
      if (end > start) selected.push({ text, start, end })
    }
    if (!selected.length) return
    const firstParent = selected[0].text.parentElement
    if (firstParent) {
      if (setting === 'font') setFont((newValue ?? '') as ResumeFont | '')
      if (setting === 'size') setSize(newValue ?? '')
    }
    let caret: HTMLElement | null = null
    for (const item of selected.reverse()) {
      const piece = document.createRange()
      piece.setStart(item.text, item.start)
      piece.setEnd(item.text, item.end)
      const wrapper = setting === 'bold' && makeBold ? document.createElement('strong') : document.createElement('span')
      if (setting === 'bold' && !makeBold) wrapper.style.fontWeight = '400'
      if (setting === 'font') wrapper.style.fontFamily = (newValue || '') as ResumeFont
      if (setting === 'size') wrapper.style.fontSize = newValue ? newValue + 'pt' : ''
      wrapper.append(piece.extractContents())
      piece.insertNode(wrapper)
      if (!caret) caret = wrapper
    }
    node.normalize()
    if (caret) {
      const end = document.createRange()
      end.selectNodeContents(caret)
      end.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(end)
      savedRange.current = end.cloneRange()
    }
    setHasSelection(false)
    onChange(richHtmlToPlain(node.innerHTML), sanitizeResumeHtml(node.innerHTML))
  }

  function saveContent() {
    if (!editor.current) return
    onChange(richHtmlToPlain(editor.current.innerHTML), sanitizeResumeHtml(editor.current.innerHTML))
  }

  function preserveToolbarSelection(event: MouseEvent<HTMLButtonElement>) {
    rememberSelection()
    event.preventDefault()
  }

  return <div className="resume-rich-editor">
    <div className="resume-format-toolbar" role="toolbar" aria-label={label + '文字格式'}>
      <button type="button" aria-label="加粗或取消加粗选中文字" title="加粗 / 取消加粗" disabled={!hasSelection} onMouseDown={preserveToolbarSelection} onClick={() => applyFormatting('bold')}><strong>B</strong></button>
      <label>字体
        <select aria-label={label + '所选文字字体'} value={font} disabled={!hasSelection} onMouseDown={() => rememberSelection()} onChange={(event) => applyFormatting('font', event.currentTarget.value)}>
          <option value="">跟随简历</option>{Object.entries(resumeFonts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label>字号
        <select aria-label={label + '所选文字字号'} value={size} disabled={!hasSelection} onMouseDown={() => rememberSelection()} onChange={(event) => applyFormatting('size', event.currentTarget.value)}>
          <option value="">跟随简历</option>{fontSizes.map((pt) => <option key={pt} value={pt}>{pt} pt</option>)}
        </select>
      </label>
      {!hasSelection && <span className="resume-format-hint">选中文字后设置</span>}
    </div>
    <div ref={editor} className={'resume-rich-input' + (multiline ? '' : ' single-line')}
      role="textbox" aria-label={label} aria-multiline={multiline} contentEditable suppressContentEditableWarning
      onInput={saveContent} onBlur={saveContent} onMouseUp={rememberSelection} onKeyUp={rememberSelection}
      onKeyDown={(event) => { if (!multiline && event.key === 'Enter') event.preventDefault() }} />
  </div>
}
