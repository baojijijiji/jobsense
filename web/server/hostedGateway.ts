import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { RequestError, parseInput, parseApplicationSummary, validateOutput, validateApplicationAnalysis,
  instruction, applicationSummaryInstruction } from './resumeAi.ts'

export interface HostedConfig {
  accessPassword: string
  sessionSecret: string
  apiKey: string
  enabled: boolean
  origins: string[]
}
interface Options { fetch?: typeof fetch; now?: () => number }
const cookieName = '__Host-jobsense-session'
const lifetime = 30 * 24 * 60 * 60
const model = 'deepseek-flash'
const routeMethods: Record<string, string> = {
  'session/status': 'GET', 'session/login': 'POST', 'session/logout': 'POST',
  'resume-ai/status': 'GET', 'resume-ai/configure': 'POST',
  'resume-ai/rewrite': 'POST', 'resume-ai/application-summary': 'POST',
}

function reply(status: number, value: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } })
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError('仅接受 JSON 请求。', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new RequestError('请求内容为空。')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > limit) { await reader.cancel(); throw new RequestError('请求内容过多，请精简后重试。', 413) }
      parts.push(part.value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) }
  catch { throw new RequestError('请求格式不完整。') }
}

function constantEqual(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

export function createHostedHandler(config: HostedConfig, options: Options = {}) {
  const now = options.now ?? Date.now
  const callModel = options.fetch ?? fetch
  const failedLogins: number[] = []
  const aiCalls: number[] = []
  let busy = false
  const signed = (value: string) => createHmac('sha256', config.sessionSecret).update(value).digest('base64url')
  const csrf = (token: string) => signed('csrf:' + token)
  const cookie = (token: string, age: number) => `${cookieName}=${token}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`
  const trimWindow = (values: number[]) => { while (values.length && values[0] <= now() - 600000) values.shift() }
  function session(request: Request) {
    const found = (request.headers.get('cookie') ?? '').split(';').map((item) => item.trim()).find((item) => item.startsWith(cookieName + '='))
    const token = found?.slice(cookieName.length + 1) ?? ''
    if (token.length > 240) return ''
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/u.test(payload)
      || !/^[A-Za-z0-9_-]{43}$/u.test(signature) || !constantEqual(signature, signed(payload))) return ''
    const [expires, nonce] = Buffer.from(payload, 'base64url').toString('utf8').split(':')
    const expiry = Number(expires)
    return nonce && Number.isSafeInteger(expiry) && expiry > now() && expiry <= now() + lifetime * 1000 ? token : ''
  }

  return async function handle(request: Request): Promise<Response> {
    try {
      if (config.accessPassword.length < 12 || config.sessionSecret.length < 32 || !config.origins.length) {
        throw new RequestError('线上登录服务尚未配置，请在部署平台设置访问口令、会话密钥和网站地址。', 503)
      }
      const url = new URL(request.url)
      if (!config.origins.includes(url.origin)) throw new RequestError('网站地址与部署配置不匹配。', 403)
      const route = url.searchParams.get('route') ?? url.pathname.replace(/^\/api\//u, '')
      if (!Object.hasOwn(routeMethods, route)) {
        throw new RequestError('接口不存在。', 404)
      }
      if (request.method !== routeMethods[route]) throw new RequestError('请求方式不支持。', 405)
      if (request.method === 'POST' && request.headers.get('origin') !== url.origin) throw new RequestError('请求来源不匹配，请刷新网站后重试。', 403)
      const token = session(request)
      if (route === 'session/status' && request.method === 'GET') return reply(200, { authenticated: !!token, ...(token ? { csrf: csrf(token) } : {}) })
      if (route === 'session/login' && request.method === 'POST') {
        trimWindow(failedLogins)
        if (failedLogins.length >= 8) throw new RequestError('登录尝试过多，请十分钟后再试。', 429)
        const input = await readJson(request, 4096)
        if (!input || typeof input !== 'object' || !('password' in input) || typeof input.password !== 'string'
          || input.password.length > 500 || !constantEqual(input.password, config.accessPassword)) {
          failedLogins.push(now()); throw new RequestError('访问口令不正确。', 401)
        }
        failedLogins.length = 0
        const payload = Buffer.from(`${now() + lifetime * 1000}:${randomBytes(24).toString('base64url')}`).toString('base64url')
        const next = payload + '.' + signed(payload)
        return reply(200, { authenticated: true, csrf: csrf(next) }, { 'Set-Cookie': cookie(next, lifetime) })
      }
      if (!token) throw new RequestError('请先登录JobSense。', 401)
      if (request.method === 'POST' && !constantEqual(request.headers.get('x-career-csrf') ?? '', csrf(token))) {
        throw new RequestError('登录状态已变化，请刷新网站后重试。', 403)
      }
      if (route === 'session/logout' && request.method === 'POST') return reply(200, { authenticated: false }, { 'Set-Cookie': cookie('', 0) })
      if (route === 'resume-ai/status' && request.method === 'GET') return reply(200, { ready: config.enabled && !!config.apiKey,
        configured: !!config.apiKey, provider: 'DeepSeek', model, csrf: csrf(token), configurationMode: 'server' })
      if (request.method !== 'POST') throw new RequestError('请求方式不支持。', 405)
      if (route === 'resume-ai/configure') throw new RequestError('线上密钥由部署平台管理，请在平台环境变量中配置。', 409)
      if (!config.enabled || !config.apiKey) throw new RequestError('服务器尚未启用DeepSeek，请在部署平台配置密钥。', 503)
      const summary = route === 'resume-ai/application-summary'
      const value = await readJson(request, 180000)
      const input = summary ? parseApplicationSummary(value) : parseInput(value)
      trimWindow(aiCalls)
      if (busy || aiCalls.length >= 12) throw new RequestError('请求繁忙或已达到十分钟调用限额，请稍后重试。', 429)
      busy = true; aiCalls.push(now())
      const controller = new AbortController()
      const cancel = () => controller.abort()
      const timeout = setTimeout(cancel, 60000)
      if (request.signal.aborted) cancel()
      request.signal.addEventListener('abort', cancel, { once: true })
      try {
        const response = await callModel('https://api.deepseek.com/chat/completions', {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
          body: JSON.stringify({ model, thinking: { type: 'disabled' }, temperature: 0.2, stream: false,
            max_tokens: summary ? 1200 : 4000, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: summary ? applicationSummaryInstruction : instruction }, { role: 'user', content: JSON.stringify(input) }] }),
        })
        if (!response.ok) {
          const errors: Record<number, string> = { 401: 'DeepSeek密钥无效，请在部署平台更换。', 402: 'DeepSeek账户余额不足。', 429: 'DeepSeek请求繁忙，请稍后重试。' }
          throw new RequestError(errors[response.status] ?? 'DeepSeek暂时不可用，原草稿已保留。', 502)
        }
        const raw = await response.text()
        if (raw.length > 150000) throw new RequestError('AI返回内容过长。', 502)
        const result = JSON.parse(raw).choices?.[0]
        if (result?.finish_reason !== 'stop' || typeof result?.message?.content !== 'string' || !result.message.content.trim()) {
          throw new RequestError('AI返回内容不完整，原草稿已保留。', 502)
        }
        const output: unknown = JSON.parse(result.message.content)
        return reply(200, summary ? validateApplicationAnalysis(output, input as ReturnType<typeof parseApplicationSummary>)
          : validateOutput(output, input as ReturnType<typeof parseInput>))
      } finally { clearTimeout(timeout); request.signal.removeEventListener('abort', cancel); busy = false }
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.message })
      return reply(502, { error: '服务暂时不可用，请稍后重试；原资料仍保留。' })
    }
  }
}
