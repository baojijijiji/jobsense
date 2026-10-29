const accountMode = import.meta.env.VITE_CLOUDBASE_MODE === 'true'
let endpointPromise: Promise<string> | undefined

async function endpoint(signal?: AbortSignal | null) {
  endpointPromise ??= fetch('/ai-endpoint.json', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('网站尚未填写 Vercel AI 后台地址，请先完成接入配置。')
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object' || !('origin' in value) || typeof value.origin !== 'string' || !value.origin) {
        throw new Error('网站尚未填写 Vercel AI 后台地址，请先完成接入配置。')
      }
      const url = new URL(value.origin)
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || !url.hostname.endsWith('.vercel.app') || url.origin !== value.origin) throw new Error('AI 后台地址格式不正确，请填写完整的 HTTPS Vercel 生产域名。')
      return url.origin
    }).catch((error: unknown) => { endpointPromise = undefined; throw error })
  const origin = await endpointPromise
  signal?.throwIfAborted()
  return origin
}

export async function aiRequest(path: string, init: RequestInit = {}) {
  if (!['/api/resume-ai/status', '/api/resume-ai/rewrite', '/api/resume-ai/application-summary', '/api/resume-ai/configure'].includes(path)) {
    throw new Error('不支持的 AI 操作。')
  }
  if (!accountMode) return fetch(path, init)
  if (path.endsWith('/configure')) throw new Error('线上密钥请在 Vercel 的环境变量中设置。')
  const origin = await endpoint(init.signal)
  const { accountAuth, accountFrom } = await import('./cloudbaseAccount')
  const result = await accountAuth.getSession()
  const session = result.data.session
  if (result.error || !accountFrom(session?.user) || !session?.access_token) throw new Error('登录已过期，请重新登录 JobSense。')
  init.signal?.throwIfAborted()
  const headers = new Headers(init.headers)
  headers.delete('X-Career-CSRF')
  headers.set('Authorization', 'Bearer ' + session.access_token)
  return fetch(origin + path, { ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(115000)]) : AbortSignal.timeout(115000) })
}
