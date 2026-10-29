import { useCallback, useEffect, useState, type ReactNode } from 'react'
import './CloudAccessGate.css'

function OnlineGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [csrf, setCsrf] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const check = useCallback(async (signal?: AbortSignal) => {
    setChecking(true); setError('')
    try {
      const response = await fetch('/api/session/status', { signal, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '网站服务暂时无法连接。')
      if (typeof result.authenticated !== 'boolean') throw new Error('网站返回状态不完整，请重试。')
      setAuthenticated(result.authenticated); setCsrf(typeof result.csrf === 'string' ? result.csrf : '')
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '网站服务暂时无法连接，请重试。')
    } finally { if (!signal?.aborted) setChecking(false) }
  }, [])
  useEffect(() => { const controller = new AbortController(); void check(controller.signal); return () => controller.abort() }, [check])

  async function login() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const result = await response.json()
      if (!response.ok || result.authenticated !== true || typeof result.csrf !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : '登录失败，请重试。')
      }
      setAuthenticated(true); setCsrf(result.csrf); setPassword('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '网站服务暂时无法连接。') }
    finally { setBusy(false) }
  }

  async function logout() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/session/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Career-CSRF': csrf }, body: '{}' })
      if (!response.ok) throw new Error('退出失败，请稍后重试。')
      setAuthenticated(false); setCsrf('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败。') }
    finally { setBusy(false) }
  }

  if (checking) return <div className="cloud-access"><div className="cloud-access-card" role="status"><h1>JobSense</h1><p>正在连接求职工作台…</p></div></div>
  if (!authenticated) return <div className="cloud-access"><form className="cloud-access-card" onSubmit={(event) => { event.preventDefault(); void login() }}>
    <div className="cloud-access-mark" aria-hidden="true">J</div><h1>JobSense</h1><p>岗位匹配与智能简历助手</p>
    <label>个人访问口令<input type="password" autoComplete="current-password" required maxLength={500} value={password} disabled={busy}
      onChange={(event) => setPassword(event.currentTarget.value)} /></label>
    {error && <p className="cloud-access-error" role="alert">{error}</p>}
    <button className="cloud-access-submit" disabled={busy || !password}>{busy ? '正在登录…' : '进入工作台'}</button>
    <button className="cloud-access-retry" type="button" disabled={busy} onClick={() => void check()}>重新连接</button>
    <p className="cloud-access-hint">此口令由你在部署平台设置，与DeepSeek密钥不同。登录会在本设备保留30天。</p>
  </form></div>
  return <><div className="cloud-session-bar"><span>JobSense · 资料保存在当前浏览器，暂未跨设备同步</span>
    <button disabled={busy} onClick={() => void logout()}>退出登录</button></div>{error && <p className="cloud-access-error" role="alert">{error}</p>}{children}</>
}

export function CloudAccessGate({ children }: { children: ReactNode }) {
  return import.meta.env.VITE_HOSTED_MODE === 'true' ? <OnlineGate>{children}</OnlineGate> : children
}
