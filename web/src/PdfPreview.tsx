import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfPreview({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    const base = import.meta.env.BASE_URL + 'pdf-assets/'
    void blob.arrayBuffer().then(async (bytes) => {
      if (cancelled) return
      task = getDocument({ data: new Uint8Array(bytes), cMapUrl: base + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/',
        useSystemFonts: true, stopAtErrors: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 32_000_000 })
      const pdf = await task.promise
      if (!cancelled) setDocument(pdf)
    }).catch((reason: unknown) => {
      if (cancelled) return
      const code = reason && typeof reason === 'object' && 'code' in reason ? reason.code : null
      setError(code === PasswordResponses.NEED_PASSWORD || code === PasswordResponses.INCORRECT_PASSWORD
        ? '这是加密 PDF，请下载后输入密码查看。当前预览不保存密码。'
        : 'PDF 无法预览，文件可能损坏或采用暂不支持的格式。请下载原件查看。')
    })
    return () => { cancelled = true; void task?.destroy().catch(() => {}) }
  }, [blob])

  useEffect(() => {
    if (!document || !canvas.current) return
    let cancelled = false
    let task: RenderTask | undefined
    const element = canvas.current
    // eslint-disable-next-line react/set-state-in-effect -- Synchronize state with a new external canvas render.
    setRendering(true)
    void document.getPage(page).then(async (pdfPage) => {
      if (cancelled) return
      const normal = pdfPage.getViewport({ scale: 1 })
      // Render only the selected page; cap bitmap size for large engineering drawings.
      const scale = Math.min(1.6, 1600 / Math.max(normal.width, normal.height), Math.sqrt(4_000_000 / (normal.width * normal.height)))
      const viewport = pdfPage.getViewport({ scale })
      element.width = Math.ceil(viewport.width)
      element.height = Math.ceil(viewport.height)
      task = pdfPage.render({ canvas: element, viewport })
      await task.promise
      if (!cancelled) { setRendering(false); setError('') }
    }).catch(() => {
      if (!cancelled) { setRendering(false); setError('此页无法预览，请下载原文件查看。') }
    })
    return () => { cancelled = true; task?.cancel() }
  }, [document, page])

  return <div className="pdf-preview" aria-busy={rendering && !error}>
    {document && <div className="button-row pdf-pagination"><button className="button" disabled={page <= 1 || rendering} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} / {document.numPages} 页</span><button className="button" disabled={page >= document.numPages || rendering} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}
    {error ? <p className="inline-error" role="alert">{error}</p> : <>{rendering && <p className="hint" role="status">正在绘制 PDF 页面…</p>}<canvas ref={canvas} role="img" aria-label={'PDF 原件第 ' + page + ' 页'} hidden={!document} /></>}
    <p className="hint">原件按页查看；文件内容只在本机处理。</p>
  </div>
}
