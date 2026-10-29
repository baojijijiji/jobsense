import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SignInRes } from '@cloudbase/js-sdk/auth'
import { accountAuth, accountError, accountFrom, cloudbaseEnvironment, createAccountProfile, loadAccountProfile, type Account } from './cloudbaseAccount'
import { CloudAccountContext } from './cloudbaseContext'
import { AccountWorkspace } from './AccountWorkspace'
import './CloudAccessGate.css'

export function CloudBaseGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [profileRetry, setProfileRetry] = useState(0)
  const [mode, setMode] = useState<'login' | 'signup' | 'verify'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const verify = useRef<((params: { token: string }) => Promise<SignInRes>) | null>(null)
  const identity = useRef<string | null>(null)
  const operation = useRef(0)
  const exitGuard = useRef<(() => Promise<boolean>) | null>(null)
  const registerExitGuard = useCallback((guard: (() => Promise<boolean>) | null) => { exitGuard.current = guard }, [])

  useEffect(() => {
    let active = true
    const accept = (next: Account | null) => {
      if (!active) return
      identity.current = next?.id ?? null
      setAccount(next); setReady(false); setChecking(false)
    }
    const listener = accountAuth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { operation.current++; accept(null); setPassword(''); setCode(''); setMode('login') }
      else if (event === 'SIGNED_IN') accept(accountFrom(session?.user))
    })
    const currentOperation = operation.current
    void accountAuth.getSession().then(async (result) => {
      if (!active || currentOperation !== operation.current) return
      if (result.error || !result.data.session) { accept(null); return }
      const user = await accountAuth.getUser()
      if (!active || currentOperation !== operation.current) return
      accept(user.error ? null : accountFrom(user.data.user))
    }).catch((cause) => { if (active && currentOperation === operation.current) { accept(null); setError(accountError(cause)) } })
    return () => { active = false; listener.data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!account) return
    let active = true
    const current = account
    void (async () => {
      try {
        const existing = await loadAccountProfile(current, new AbortController().signal)
        if (!active || identity.current !== current.id) return
        if (!existing) {
          try { await createAccountProfile(current, new AbortController().signal) }
          catch {
            // Another signed-in tab may have created the profile at the same time.
            const afterRace = await loadAccountProfile(current, new AbortController().signal)
            if (!afterRace) throw new Error('无法初始化账号资料空间，请稍后重新登录。')
          }
        }
        if (active && identity.current === current.id) { setReady(true); setError('') }
      } catch (cause) {
        if (active && identity.current === current.id) setError(cause instanceof Error ? cause.message : '无法连接账号资料空间。')
      }
    })()
    return () => { active = false }
  }, [account, profileRetry])

  async function submit() {
    if (busy) return
    const current = ++operation.current
    setBusy(true); setError('')
    try {
      if (mode === 'signup') {
        const result = await accountAuth.signUp({ email: email.trim(), password })
        if (result.error) throw result.error
        if (current !== operation.current) return
        setPassword('')
        if (result.data.verifyOtp) { verify.current = result.data.verifyOtp; setMode('verify'); return }
        const next = accountFrom(result.data.user)
        if (!next) throw new Error('注册未完成，请重新尝试。')
        identity.current = next.id; setAccount(next)
      } else {
        const result = mode === 'verify'
          ? await verify.current?.({ token: code.trim() })
          : await accountAuth.signInWithPassword({ email: email.trim(), password })
        if (!result || result.error) throw result?.error ?? new Error('验证码已失效，请重新注册。')
        if (current !== operation.current) return
        const next = accountFrom(result.data.user ?? result.data.session?.user)
        if (!next) throw new Error('账号身份不完整，请重新登录。')
        identity.current = next.id; setAccount(next); setPassword(''); setCode(''); verify.current = null; setMode('login')
      }
    } catch (cause) { if (current === operation.current) setError(accountError(cause)) }
    finally { if (current === operation.current) setBusy(false) }
  }

  async function logout() {
    if (exitGuard.current && !(await exitGuard.current())) return
    setBusy(true); setError('')
    try {
      const result: unknown = await accountAuth.signOut()
      if (result && typeof result === 'object' && 'error' in result && result.error) throw result.error
      identity.current = null; setAccount(null); setReady(false); setPassword(''); setCode(''); setMode('login')
    } catch (cause) { setError(accountError(cause)) }
    finally { setBusy(false) }
  }

  if (checking || (account && !ready && !error)) return <div className="cloud-access"><div className="cloud-access-card" role="status"><h1>JobSense</h1><p>{checking ? '正在检查账号状态……' : '正在连接你的云端资料空间……'}</p></div></div>
  if (account && ready) return <CloudAccountContext.Provider value={account}><div className="cloud-session-bar"><span>JobSense · {account.email || account.name} · 账号资料同步</span><button disabled={busy} onClick={() => void logout()}>{busy ? '正在退出…' : '退出登录'}</button></div>{error && <p className="cloud-access-error" role="alert">{error}</p>}<AccountWorkspace key={account.id} account={account} registerExitGuard={registerExitGuard}>{children}</AccountWorkspace></CloudAccountContext.Provider>
  if (account && error) return <div className="cloud-access"><section className="cloud-access-card"><div className="cloud-access-mark" aria-hidden="true">J</div><h1>账号已登录</h1><p>{account.email || account.name}</p><p className="cloud-access-error" role="alert">{error}</p><button className="cloud-access-submit" disabled={busy} onClick={() => { setError(''); setProfileRetry((value) => value + 1) }}>重新连接资料空间</button><button className="cloud-access-retry" disabled={busy} onClick={() => void logout()}>退出账号</button></section><p className="account-environment">账号服务：腾讯云 CloudBase · 上海<br />{cloudbaseEnvironment}</p></div>
  return <div className="cloud-access"><form className="cloud-access-card" onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <div className="cloud-access-mark" aria-hidden="true">J</div><h1>JobSense</h1><p>岗位匹配与智能简历助手 · 你的个人求职资料空间</p>
    <label htmlFor="cloud-account-email">邮箱<input id="cloud-account-email" type="email" autoComplete="username" required maxLength={254} value={email} disabled={busy || mode === 'verify'} onChange={(event) => setEmail(event.currentTarget.value)} /></label>
    {mode === 'verify' ? <label htmlFor="cloud-account-code">邮箱验证码<input id="cloud-account-code" inputMode="numeric" autoComplete="one-time-code" required maxLength={16} value={code} disabled={busy} onChange={(event) => setCode(event.currentTarget.value)} /></label>
      : <label htmlFor="cloud-account-password">密码<input id="cloud-account-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : 1} maxLength={128} value={password} disabled={busy} onChange={(event) => setPassword(event.currentTarget.value)} /></label>}
    {mode === 'verify' && <p className="cloud-access-hint">验证码已发送到你的邮箱，输入后完成注册。密码不会保存在网页设置中。</p>}
    {error && <p className="cloud-access-error" role="alert">{error}</p>}
    <button className="cloud-access-submit" disabled={busy}>{busy ? '正在处理…' : mode === 'signup' ? '发送验证码并注册' : mode === 'verify' ? '验证并进入账号' : '登录并查看资料'}</button>
    <button className="cloud-access-retry" type="button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setPassword(''); setCode(''); setError(''); verify.current = null }}>{mode === 'login' ? '注册新账号' : '返回账号密码登录'}</button>
    <p className="cloud-access-hint">经历、教育、投递记录、简历、照片和设置保存到当前账号。旧本机文字资料需主动导入；照片在简历编辑中重新上传，附件私有云同步仍在准备中。</p>
  </form><p className="account-environment">账号服务：腾讯云 CloudBase · 上海<br />{cloudbaseEnvironment}</p></div>
}
