import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { ReadableStream } from 'node:stream/web'
import { createHostedHandler, type HostedConfig } from './hostedGateway.ts'

interface Options { fetch?: typeof fetch }
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf',
}

export function cloudbaseConfig(env: Record<string, string | undefined>): HostedConfig {
  let origin = ''
  try {
    const url = new URL(env.JOBSENSE_SITE_ORIGIN?.trim() ?? '')
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin
  } catch { /* Missing or invalid origin keeps the AI gateway closed. */ }
  return { accessPassword: env.JOBSENSE_ACCESS_PASSWORD ?? '', sessionSecret: env.JOBSENSE_SESSION_SECRET ?? '',
    apiKey: env.DEEPSEEK_API_KEY?.trim() ?? '', enabled: env.DEEPSEEK_ENABLED === 'true', origins: origin ? [origin] : [] }
}

function message(response: ServerResponse, status: number, error: string) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify({ error }))
}

// Cancelling the Web reader drains the incoming body rather than closing the HTTP
// socket, so oversized/unauthorized requests can still receive their error reply.
function requestBody(request: IncomingMessage) {
  let finished = false
  let onData: (chunk: Buffer) => void
  let onEnd: () => void
  let onError: (error: Error) => void
  const clean = () => { request.off('data', onData); request.off('end', onEnd); request.off('error', onError) }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      request.pause()
      onData = (chunk) => { controller.enqueue(new Uint8Array(chunk)); request.pause() }
      onEnd = () => { finished = true; clean(); controller.close() }
      onError = (error) => { finished = true; clean(); controller.error(error) }
      request.on('data', onData); request.once('end', onEnd); request.once('error', onError)
    },
    pull() { if (!finished) request.resume() },
    cancel() { if (!finished) { finished = true; clean(); request.resume() } },
  })
}

function contained(root: string, path: string) {
  const subpath = relative(root, path)
  return !!subpath && subpath !== '..' && !subpath.startsWith('..' + sep) && !isAbsolute(subpath)
}

export function createCloudbaseListener(publicDirectory: string, config: HostedConfig, options: Options = {}) {
  const root = resolve(publicDirectory)
  const canonicalOrigin = config.origins[0] ?? 'https://unconfigured.invalid'
  const gateway = createHostedHandler(config, options)
  const allowedHeaders = ['content-type', 'content-length', 'cookie', 'origin', 'x-career-csrf']

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A disconnect can happen while a rejected upload is still being drained.
    request.once('error', () => {})
    try {
      if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.length > 8192) {
        message(response, 400, '请求地址不正确。'); return
      }
      const url = new URL(request.url, canonicalOrigin)
      if (url.origin !== canonicalOrigin) { message(response, 400, '请求地址不正确。'); return }
      if (url.pathname === '/healthz' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end('{"ok":true}'); return
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        // CloudBase routes use their actual path, not the Vercel rewrite query.
        url.searchParams.delete('route')
        const headers = new Headers()
        for (const name of allowedHeaders) { const value = request.headers[name]; if (typeof value === 'string') headers.set(name, value) }
        const controller = new AbortController()
        const cancel = () => controller.abort()
        const close = () => { if (!response.writableFinished) cancel() }
        request.once('aborted', cancel); response.once('close', close)
        const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, signal: controller.signal }
        if (request.method !== 'GET' && request.method !== 'HEAD') { init.body = requestBody(request); init.duplex = 'half' }
        const webRequest = new Request(url, init)
        try {
          const result = await gateway(webRequest)
          if (response.destroyed) return
          const body = Buffer.from(await result.arrayBuffer())
          response.statusCode = result.status
          result.headers.forEach((value, name) => response.setHeader(name, value))
          response.end(body)
        } finally {
          if (webRequest.body && !webRequest.body.locked) await webRequest.body.cancel().catch(() => {})
          request.off('aborted', cancel); response.off('close', close)
        }
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { message(response, 405, '请求方式不支持。'); return }
      let pathname: string
      try { pathname = decodeURIComponent(url.pathname) } catch { message(response, 400, '请求地址不正确。'); return }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':') || pathname.split('/').some((part) => part.startsWith('.'))) {
        message(response, 404, '文件不存在。'); return
      }
      const filename = pathname === '/' ? 'index.html' : pathname.slice(1)
      const target = resolve(root, filename)
      if (!contained(root, target)) { message(response, 404, '文件不存在。'); return }
      let actual: string
      try {
        const actualRoot = await realpath(root)
        actual = await realpath(target)
        if (!contained(actualRoot, actual)) { message(response, 404, '文件不存在。'); return }
        const info = await stat(actual)
        if (!info.isFile()) { message(response, 404, '文件不存在。'); return }
        response.writeHead(200, { 'Content-Type': contentTypes[extname(actual).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff',
          'Cache-Control': filename === 'index.html' ? 'no-store' : filename.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400' })
      } catch { message(response, 404, '文件不存在。'); return }
      if (request.method === 'HEAD') { response.end(); return }
      await new Promise<void>((done) => {
        const source = createReadStream(actual)
        const cleanup = () => { source.destroy(); done() }
        response.once('finish', cleanup); response.once('close', cleanup)
        source.once('error', () => { response.destroy(); done() })
        source.pipe(response)
      })
    } catch {
      if (!response.headersSent && !response.destroyed) message(response, 503, '网站服务暂时不可用，请稍后重试。')
      else if (!response.writableEnded) response.destroy()
    }
  }
}
