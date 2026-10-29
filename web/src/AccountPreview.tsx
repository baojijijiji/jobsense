import { useEffect, useRef, useState } from 'react'
import type { SignInRes } from '@cloudbase/js-sdk/auth'
import { accountAuth, accountError, accountFrom, cloudbaseEnvironment, createAccountProfile, loadAccountProfile,
  type Account, type AccountProfile } from './cloudbaseAccount'
import './CloudAccessGate.css'
import './AccountPreview.css'

export function AccountPreview() {
  const [account, setAccount] = useState<Account | null>(null)
  const [checking, setChecking] = useState(true)
  const [mode, setMode] = useState<'login' | 'signup' | 'verify'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileReload, setProfileReload] = useState(0)
  const verify = useRef<((params: { token: string }) => Promise<SignInRes>) | null>(null)
  const alive = useRef(false)
  const operation = useRef(0)
  const profileRequest = useRef<AbortController | null>(null)
  const identity = useRef<string | null>(null)

  useEffect(() => {
    alive.current = true
    let disposed = false
    const cancelProfileRequest = () => profileRequest.current?.abort()
    const apply = (next: Account | null) => {
      if (disposed || !alive.current) return
      identity.current = next?.id ?? null
      profileRequest.current?.abort()
      setProfile(null); setProfileError(''); setAccount(next); setChecking(false)
    }
    const listener = accountAuth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { operation.current++; apply(null); setBusy(false); setPassword(''); setCode(''); verify.current = null; setMode('login') }
      else if (event === 'SIGNED_IN') apply(accountFrom(session?.user))
    })
    const version = operation.current
    void accountAuth.getSession().then(async (session) => {
      if (disposed || !alive.current || operation.current !== version) return
      if (session.error || !session.data.session) { apply(null); return }
      const result = await accountAuth.getUser()
      if (disposed || !alive.current || operation.current !== version) return
      if (result.error) { apply(null); setError(accountError(result.error)); return }
      apply(accountFrom(result.data.user))
    }).catch((cause) => { if (!disposed && alive.current && operation.current === version) { apply(null); setError(accountError(cause)) } })
    return () => { disposed = true; alive.current = false; listener.data.subscription.unsubscribe(); cancelProfileRequest() }
  }, [])

  useEffect(() => {
    if (!account) return
    const current = account
    const controller = new AbortController()
    profileRequest.current = controller
    // Updates follow a scheduled async read, rather than rendering stale account data.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      setProfileBusy(true); setProfileError('')
      try {
        const result = await loadAccountProfile(current, controller.signal)
        if (!controller.signal.aborted && identity.current === current.id) setProfile(result)
      } catch (cause) {
        if (!controller.signal.aborted && identity.current === current.id) setProfileError(cause instanceof Error ? cause.message : '无法读取个人空间。')
      } finally { if (!controller.signal.aborted && identity.current === current.id) setProfileBusy(false) }
    })
    return () => controller.abort()
  }, [account, profileReload])

  async function submit() {
    if (busy) return
    const version = ++operation.current
    setBusy(true); setError('')
    try {
      if (mode === 'signup') {
        const result = await accountAuth.signUp({ email: email.trim(), password })
        if (result.error) throw result.error
        if (!alive.current || version !== operation.current) return
        setPassword('')
        if (result.data.verifyOtp) { verify.current = result.data.verifyOtp; setMode('verify'); return }
        const next = accountFrom(result.data.user)
        if (!next) throw new Error('注册未完成')
        identity.current = next.id; setAccount(next)
      } else {
        const result = mode === 'verify'
          ? await verify.current?.({ token: code.trim() })
          : await accountAuth.signInWithPassword({ email: email.trim(), password })
        if (!result || result.error) throw result?.error ?? new Error('验证状态失效')
        if (!alive.current || version !== operation.current) return
        const next = accountFrom(result.data.user ?? result.data.session?.user)
        if (!next) throw new Error('账号身份不完整')
        identity.current = next.id; setAccount(next); setPassword(''); setCode(''); verify.current = null; setMode('login')
      }
    } catch (cause) { if (alive.current && operation.current === version) setError(accountError(cause)) }
    finally { if (alive.current && operation.current === version) setBusy(false) }
  }

  async function logout() {
    if (busy) return
    setBusy(true); setError('')
    profileRequest.current?.abort()
    setProfile(null)
    try {
      const result: unknown = await accountAuth.signOut()
      if (result && typeof result === 'object' && 'error' in result && result.error) throw result.error
      if (!alive.current) return
      identity.current = null; setAccount(null); setPassword(''); setCode(''); verify.current = null; setMode('login')
    } catch (cause) { if (alive.current) setError(accountError(cause)) }
    finally { if (alive.current) setBusy(false) }
  }

  async function initializeProfile() {
    if (!account || profileBusy) return
    const current = account
    const controller = new AbortController()
    profileRequest.current?.abort(); profileRequest.current = controller
    setProfileBusy(true); setProfileError('')
    try {
      const result = await createAccountProfile(current, controller.signal)
      if (!controller.signal.aborted && identity.current === current.id) setProfile(result)
    } catch (cause) {
      if (!controller.signal.aborted && identity.current === current.id) setProfileError(cause instanceof Error ? cause.message : '无法初始化个人空间。')
    } finally { if (!controller.signal.aborted && identity.current === current.id) setProfileBusy(false) }
  }

  return <main className="cloud-access account-preview">
    {checking ? <div className="cloud-access-card" role="status"><h1>JobSense</h1><p>正在检查账号状态……</p></div>
      : account ? <section className="cloud-access-card account-space">
        <div className="cloud-access-mark" aria-hidden="true">J</div><h1>我的账号空间</h1>
        <p>{account.email || account.name || '已登录账号'}</p><p className="account-id">账号ID：{account.id}</p>
        {profileBusy && <p role="status">正在读取个人空间……</p>}
        {profileError && <p className="cloud-access-error" role="alert">{profileError}</p>}
        {profile?.user_id === account.id && !profileError && <div className="account-status">个人空间已连接 · 版本{profile.version}</div>}
        {!profileBusy && !profileError && !profile && <button className="cloud-access-submit" onClick={() => void initializeProfile()}>初始化我的个人空间</button>}
        <p className="cloud-access-hint">当前为账号接入预览。经历、简历和附件将在后续小步接入这个账号空间。</p>
        {error && <p className="cloud-access-error" role="alert">{error}</p>}
        <button className="cloud-access-retry" disabled={busy || profileBusy} onClick={() => setProfileReload((value) => value + 1)}>重新读取个人空间</button>
        <button className="cloud-access-submit" disabled={busy} onClick={() => void logout()}>{busy ? '正在退出……' : '退出登录'}</button>
      </section> : <form className="cloud-access-card" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="cloud-access-mark" aria-hidden="true">J</div><h1>JobSense账号</h1><p>账号接入预览 · {mode === 'signup' ? '注册新账号' : mode === 'verify' ? '验证邮箱' : '账号密码登录'}</p>
        <label htmlFor="account-email">邮箱<input id="account-email" type="email" autoComplete="username" required maxLength={254} value={email} disabled={busy || mode === 'verify'} onChange={(event) => setEmail(event.currentTarget.value)} /></label>
        {mode === 'verify' ? <label htmlFor="account-code">邮箱验证码<input id="account-code" inputMode="numeric" autoComplete="one-time-code" required maxLength={16} value={code} disabled={busy} onChange={(event) => setCode(event.currentTarget.value)} /></label>
          : <label htmlFor="account-password">密码<input id="account-password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 8 : 1} maxLength={128} value={password} disabled={busy} onChange={(event) => setPassword(event.currentTarget.value)} /></label>}
        {mode === 'verify' && <p className="cloud-access-hint">验证码已发送到填写的邮箱，输入后完成注册。密码不会保存在网页设置中。</p>}
        {error && <p className="cloud-access-error" role="alert">{error}</p>}
        <button className="cloud-access-submit" disabled={busy}>{busy ? '正在处理……' : mode === 'signup' ? '发送验证码并注册' : mode === 'verify' ? '验证并进入账号空间' : '登录'}</button>
        <button type="button" className="cloud-access-retry" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setPassword(''); setCode(''); setError(''); verify.current = null }}>{mode === 'login' ? '注册新账号' : '返回账号密码登录'}</button>
        <p className="cloud-access-hint">此入口预览独立账号，不读取本机经历或附件。现有工作台仍使用原来的本机入口。</p>
      </form>}
    <p className="account-environment">账号服务：腾讯云CloudBase · 上海<br />{cloudbaseEnvironment}</p>
  </main>
}
