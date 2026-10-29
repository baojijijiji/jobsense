import { RequestError, parseInput, parseApplicationSummary, validateOutput, validateApplicationAnalysis,
  instruction, applicationSummaryInstruction } from './resumeAi.ts'

export interface AccountAiConfig {
  environment: string
  siteOrigin: string
  apiKey: string
  enabled: boolean
}

const model = 'deepseek-flash'
const routes: Record<string, string> = { status: 'GET', rewrite: 'POST', 'application-summary': 'POST' }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

async function boundedText(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const parts: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) { await reader.cancel(); throw new RequestError('服务返回内容过长，未覆盖草稿。', 502) }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(parts).toString('utf8')
}

async function readInput(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RequestError('仅接受 JSON 请求。', 415)
  try { return JSON.parse(await boundedText(new Response(request.body), 180000)) as unknown }
  catch (error) { if (error instanceof RequestError) throw error; throw new RequestError('请求格式不完整。') }
}

// CloudBase validates the bearer token and applies the user's RLS policies.
// This gateway has no administrator key and does not trust a client-supplied user ID.
export function createAccountAiHandler(config: AccountAiConfig, send: typeof fetch = fetch) {
  const root = `https://${config.environment}.api.tcloudbasegateway.com/v1/rdb/rest/`
  let validOrigin = false
  try { validOrigin = new URL(config.siteOrigin).origin === config.siteOrigin && config.siteOrigin.startsWith('https://') } catch { /* Fail closed. */ }

  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin') ?? ''
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', Vary: 'Origin' })
    const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers })
    if (!validOrigin || origin !== config.siteOrigin) return reply(403, { error: '此网站未获 AI 后台授权。' })
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    headers.set('Access-Control-Max-Age', '600')
    if (request.method === 'OPTIONS') {
      const requested = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map((name) => name.trim()).filter(Boolean)
      if (!['GET', 'POST'].includes(request.headers.get('access-control-request-method') ?? '')
        || requested.some((name) => !['authorization', 'content-type'].includes(name))) return reply(403, { error: '请求方式未获授权。' })
      return new Response(null, { status: 204, headers })
    }

    let token = ''
    let lease = ''
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
    const overallTimeout = setTimeout(abort, 95000)
    async function database(path: string, body?: unknown, signal = controller.signal): Promise<unknown> {
      const response = await send(root + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      if (response.status === 401) throw new RequestError('登录已过期，请重新登录 JobSense。', 401)
      if (!response.ok) throw new RequestError('账号 AI 权限尚未准备好，请先执行 003 AI 限额脚本并核对数据库权限。', 503)
      try { return JSON.parse(await boundedText(response, 250000)) as unknown }
      catch (error) { if (error instanceof RequestError) throw error; throw new RequestError('账号服务返回格式异常。', 502) }
    }

    try {
      if (!/^[a-z0-9-]{1,100}$/u.test(config.environment)) throw new RequestError('AI 账号服务配置异常。', 503)
      const route = new URL(request.url).searchParams.get('action') ?? ''
      if (!Object.hasOwn(routes, route)) throw new RequestError('AI 接口不存在。', 404)
      if (routes[route] !== request.method) throw new RequestError('请求方式不支持。', 405)
      const authorization = request.headers.get('authorization') ?? ''
      if (!/^Bearer [A-Za-z0-9._~-]{10,12000}$/u.test(authorization)) throw new RequestError('请先登录 JobSense。', 401)
      token = authorization.slice(7)
      const profiles = await database('jobsense_profiles?select=user_id&limit=2')
      const profile = Array.isArray(profiles) && profiles.length === 1 && record(profiles[0]) ? profiles[0] : null
      if (!profile || typeof profile.user_id !== 'string' || !profile.user_id || profile.user_id.length > 64) {
        throw new RequestError('账号个人资料尚未初始化，请重新登录后重试。', 403)
      }
      // The profile query uses this request's bearer token and CloudBase RLS,
      // so this ID is derived from the authenticated account, never the client.
      const userId = profile.user_id
      const budget = await database('rpc/jobsense_ai_budget_status', {})
      if (!record(budget) || budget.user_id !== userId || budget.daily_limit !== 50 || budget.window_limit !== 12) {
        throw new RequestError('AI 限额配置异常，当前不会调用模型。', 503)
      }
      if (route === 'status') return reply(200, { ready: config.enabled && !!config.apiKey, configured: !!config.apiKey,
        provider: 'DeepSeek', model, csrf: '', authentication: 'bearer', configurationMode: 'server',
        remainingToday: budget.remaining_today, dailyLimit: 50, windowLimit: 12 })
      if (!config.enabled || !config.apiKey) throw new RequestError('请在 Vercel 配置 DEEPSEEK_API_KEY 并重新部署。', 503)
      const summary = route === 'application-summary'
      const value = await readInput(request)
      const input = summary ? parseApplicationSummary(value) : parseInput(value)
      if (!summary) {
        const entries = (input as ReturnType<typeof parseInput>).entries
        const query = new URLSearchParams({ select: 'user_id,id,title,type,role,summary,outcome,skills',
          user_id: 'eq.' + userId, deleted_at: 'is.null', id: 'in.(' + entries.map((entry) => JSON.stringify(entry.id)).join(',') + ')', limit: '12' })
        const rows = await database('jobsense_experiences?' + query)
        if (!Array.isArray(rows) || rows.length !== entries.length || entries.some((entry) => {
          const row = rows.find((item) => record(item) && item.id === entry.id)
          return !record(row) || row.user_id !== userId
            || ['id', 'title', 'type', 'role', 'summary', 'outcome'].some((key) => row[key] !== entry[key as keyof typeof entry])
            || JSON.stringify(row.skills) !== JSON.stringify(entry.skills)
        })) throw new RequestError('所选经历已变化或不属于当前账号，请重新读取经历并准备候选。', 409)
      }
      const reserved = await database('rpc/jobsense_ai_reserve', {})
      if (!record(reserved) || reserved.allowed !== true || typeof reserved.lease_id !== 'string'
        || !/^[0-9a-f-]{36}$/iu.test(reserved.lease_id)) {
        const messages: Record<string, string> = { busy: '已有 AI 请求正在处理，请稍后再试。', daily: '已达到今天 50 次 AI 请求上限。', window: '已达到十分钟内 12 次请求上限，请稍后再试。' }
        throw new RequestError(record(reserved) && typeof reserved.reason === 'string' ? messages[reserved.reason] ?? 'AI 限额服务暂时不可用。' : 'AI 限额服务暂时不可用。', 429)
      }
      lease = reserved.lease_id
      const modelSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
      const response = await send('https://api.deepseek.com/chat/completions', { method: 'POST', credentials: 'omit', redirect: 'error', signal: modelSignal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey },
        body: JSON.stringify({ model, thinking: { type: 'disabled' }, temperature: 0.2, stream: false,
          max_tokens: summary ? 1200 : 4000, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: summary ? applicationSummaryInstruction : instruction }, { role: 'user', content: JSON.stringify(input) }] }) })
      if (!response.ok) {
        await response.body?.cancel()
        const messages: Record<number, string> = { 401: 'DeepSeek 密钥无效，请在 Vercel 更换。', 402: 'DeepSeek 账户余额不足。', 429: 'DeepSeek 请求繁忙，请稍后重试。' }
        throw new RequestError(messages[response.status] ?? 'DeepSeek 暂时不可用，原草稿已保留。', 502)
      }
      const raw = JSON.parse(await boundedText(response, 150000))
      const result = raw?.choices?.[0]
      if (result?.finish_reason !== 'stop' || typeof result?.message?.content !== 'string' || !result.message.content.trim()) {
        throw new RequestError('AI 返回不完整，原草稿已保留。', 502)
      }
      const output: unknown = JSON.parse(result.message.content)
      return reply(200, summary ? validateApplicationAnalysis(output, input as ReturnType<typeof parseApplicationSummary>)
        : validateOutput(output, input as ReturnType<typeof parseInput>))
    } catch (error) {
      if (error instanceof RequestError) return reply(error.status, { error: error.message })
      return reply(502, { error: 'AI 请求未完成，可能是网络、超时或返回格式问题；原草稿已保留，不会自动重试。' })
    } finally {
      clearTimeout(overallTimeout)
      request.signal.removeEventListener('abort', abort)
      // A fresh signal releases a lease even after the caller disconnects.
      // A failed release expires automatically; it never refunds call counts.
      if (lease) await database('rpc/jobsense_ai_release', { p_lease_id: lease }, AbortSignal.timeout(4000)).catch(() => {})
    }
  }
}
