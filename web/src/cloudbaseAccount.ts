import cloudbase from '@cloudbase/js-sdk'

// Environment IDs are public identifiers. No API Key or service_role key belongs here.
export const cloudbaseEnvironment = (import.meta.env.VITE_CLOUDBASE_ENV_ID ?? '').trim()
const client = cloudbase.init({ env: cloudbaseEnvironment, region: 'ap-shanghai', persistence: 'session', debug: false })
export const accountAuth = client.auth()

export interface Account { id: string; email: string; name: string }
export interface AccountProfile { user_id: string; display_name: string; version: number; updated_at: string }

export function accountFrom(value: unknown): Account | null {
  if (!value || typeof value !== 'object') return null
  const user = value as Record<string, unknown>
  if (typeof user.id !== 'string' || !user.id || user.id.length > 64 || user.is_anonymous === true
    || (Array.isArray(user.role) && user.role.includes('anon'))) return null
  const metadata = user.user_metadata as Record<string, unknown> | undefined
  return { id: user.id, email: typeof user.email === 'string' ? user.email : '',
    name: typeof metadata?.name === 'string' ? metadata.name.slice(0, 100) : '' }
}

export function accountError(error: unknown) {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const detail = String(value.code ?? '') + ' ' + String(value.message ?? '')
  if (/invalid.*(credentials|password)|credentials.*invalid|账号.*密码|密码.*错误/iu.test(detail)) return '账号或密码不正确，请重新填写。'
  if (/otp|verification.*(invalid|expired)|验证码/iu.test(detail)) return '验证码不正确或已过期，请重新注册获取验证码。'
  if (/rate|too.many|频繁/iu.test(detail)) return '操作过于频繁，请稍后重试。'
  if (/domain|origin|安全域名/iu.test(detail)) return '当前网址尚未获账号服务授权，请在CloudBase配置安全域名。'
  return '账号服务暂时无法完成请求，请检查网络和CloudBase身份认证设置后重试。'
}

async function profileRequest(account: Account, create: boolean, signal: AbortSignal): Promise<AccountProfile | null> {
  const session = await accountAuth.getSession()
  if (session.error || accountFrom(session.data.session?.user)?.id !== account.id || !session.data.session?.access_token) {
    throw new Error('登录状态已变化，请重新登录。')
  }
  signal.throwIfAborted()
  const url = new URL(`https://${cloudbaseEnvironment}.api.tcloudbasegateway.com/v1/rdb/rest/jobsense_profiles`)
  url.searchParams.set('select', 'user_id,display_name,version,updated_at')
  if (!create) url.searchParams.set('user_id', 'eq.' + account.id)
  const response = await fetch(url, { method: create ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), headers: { Authorization: 'Bearer ' + session.data.session.access_token, Accept: 'application/json',
      ...(create ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}) },
    ...(create ? { body: JSON.stringify({ display_name: account.name }) } : {}) }).catch(() => {
      signal.throwIfAborted()
      throw new Error('暂时无法连接个人空间，请检查网络后重试。')
    })
  if (!response.ok) {
    if (response.status === 401) throw new Error('登录已过期，请重新登录。')
    throw new Error('个人空间尚不可用，请完成数据库权限配置后重试。')
  }
  const rows: unknown = await response.json().catch(() => { throw new Error('个人空间返回格式异常，未显示数据。') })
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('个人空间返回格式异常，未显示数据。')
  if (!rows.length) return null
  const row = rows[0] as AccountProfile
  if (!row || row.user_id !== account.id || typeof row.display_name !== 'string' || !Number.isSafeInteger(row.version)
    || row.version < 1 || typeof row.updated_at !== 'string') throw new Error('个人空间返回归属异常，未显示数据。')
  return row
}

export const loadAccountProfile = (account: Account, signal: AbortSignal) => profileRequest(account, false, signal)
export const createAccountProfile = (account: Account, signal: AbortSignal) => profileRequest(account, true, signal)
