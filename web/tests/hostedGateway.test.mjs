import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostedHandler } from '../server/hostedGateway.ts'

const origin = 'https://jobsense.example'
const config = { accessPassword: 'test-only-password-123', sessionSecret: 'test-only-session-secret-at-least-32-characters',
  apiKey: 'test-only-not-a-real-provider-key', enabled: true, origins: [origin] }
const input = { job: '这个岗位需要数据分析能力并能整理报告。', style: 'concise', selection: 'rank', entries: [
  { id: 'sample-1', title: '虚构分析练习', type: '项目', role: '参与者', summary: '分析数据并整理报告', outcome: '完成8项分析', skills: ['数据分析'] },
] }
const output = { jobFocus: [{ label: '数据分析', quote: '需要数据分析能力', priority: 'required' }], entries: [
  { id: 'sample-1', assessment: { level: 'direct', reason: '虚构分析内容对应数据分析要求。', jobEvidence: ['需要数据分析能力'] },
    bullets: [{ text: '分析数据并整理报告', evidence: ['分析数据并整理报告'] }] },
] }
const mockFetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), { status: 200 })

function request(route, { method = 'GET', body, cookie, csrf, requestOrigin = origin } = {}) {
  const headers = {}
  if (method === 'POST') { headers['content-type'] = 'application/json'; headers.origin = requestOrigin }
  if (cookie) headers.cookie = cookie
  if (csrf) headers['x-career-csrf'] = csrf
  return new Request(`${origin}/api/handler?route=${route}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}
async function login(handler) {
  const response = await handler(request('session/login', { method: 'POST', body: { password: config.accessPassword } }))
  assert.equal(response.status, 200)
  const value = await response.json()
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: value.csrf, setCookie: response.headers.get('set-cookie') }
}

test('missing deployment secrets fail closed', async () => {
  const handler = createHostedHandler({ ...config, sessionSecret: '' }, { fetch: () => { throw new Error('must not call provider') } })
  assert.equal((await handler(request('resume-ai/status'))).status, 503)
})
test('anonymous AI calls are rejected before provider access', async () => {
  let calls = 0
  const handler = createHostedHandler(config, { fetch: async () => { calls++; return mockFetch() } })
  assert.equal((await handler(request('resume-ai/rewrite', { method: 'POST', body: input }))).status, 401)
  assert.equal(calls, 0)
})
test('status and unknown routes cannot be used to trigger AI writes', async () => {
  let calls = 0
  const handler = createHostedHandler(config, { fetch: async () => { calls++; return mockFetch() } })
  const session = await login(handler)
  for (const route of ['session/status', 'resume-ai/status']) {
    assert.equal((await handler(request(route, { method: 'POST', body: input, ...session }))).status, 405)
  }
  assert.equal((await handler(request('unknown', { method: 'POST', body: input, ...session }))).status, 404)
  assert.equal(calls, 0)
})
test('login cookie is secure and survives a fresh server instance', async () => {
  const initial = createHostedHandler(config)
  const session = await login(initial)
  assert.match(session.setCookie, /HttpOnly; Secure; SameSite=Strict/u)
  const restarted = createHostedHandler(config)
  const response = await restarted(request('session/status', session))
  assert.deepEqual(await response.json(), { authenticated: true, csrf: session.csrf })
})
test('cross-origin and incorrect CSRF writes never call the provider', async () => {
  let calls = 0
  const handler = createHostedHandler(config, { fetch: async () => { calls++; return mockFetch() } })
  const session = await login(handler)
  assert.equal((await handler(request('resume-ai/rewrite', { method: 'POST', body: input, ...session, requestOrigin: 'https://untrusted.example' }))).status, 403)
  assert.equal((await handler(request('resume-ai/rewrite', { method: 'POST', body: input, ...session, csrf: 'wrong' }))).status, 403)
  assert.equal(calls, 0)
})
test('tampered and expired sessions are rejected', async () => {
  let clock = 1700000000000
  const handler = createHostedHandler(config, { now: () => clock })
  const session = await login(handler)
  const tampered = session.cookie.slice(0, -1) + (session.cookie.endsWith('a') ? 'b' : 'a')
  assert.equal((await (await handler(request('session/status', { cookie: tampered }))).json()).authenticated, false)
  clock += 31 * 24 * 60 * 60 * 1000
  assert.equal((await (await handler(request('session/status', session))).json()).authenticated, false)
})
test('provider configuration response never exposes secret values', async () => {
  const handler = createHostedHandler(config)
  const session = await login(handler)
  const response = await handler(request('resume-ai/status', session))
  const text = await response.text()
  assert.equal(response.status, 200)
  assert.equal(JSON.parse(text).configurationMode, 'server')
  for (const secret of [config.apiKey, config.accessPassword, config.sessionSecret]) assert.equal(text.includes(secret), false)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
test('valid mocked AI request uses shared source validation and restores quantitative outcome', async () => {
  let calls = 0
  const handler = createHostedHandler(config, { fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions')
    assert.deepEqual(JSON.parse(JSON.parse(init.body).messages[1].content), input)
    return mockFetch()
  } })
  const session = await login(handler)
  const response = await handler(request('resume-ai/rewrite', { method: 'POST', body: input, ...session }))
  assert.equal(response.status, 200)
  const value = await response.json()
  assert.deepEqual(value.recommendedIds, ['sample-1'])
  assert.match(value.entries[0].text, /完成8项分析/u)
  assert.equal(calls, 1)
})
test('oversized input and application records with company fields are rejected', async () => {
  let calls = 0
  const handler = createHostedHandler(config, { fetch: async () => { calls++; return mockFetch() } })
  const session = await login(handler)
  assert.equal((await handler(request('resume-ai/rewrite', { method: 'POST', body: { huge: 'a'.repeat(180001) }, ...session }))).status, 413)
  assert.equal((await handler(request('resume-ai/application-summary', { method: 'POST', body: { total: 1, byType: [], byStage: [], byMonth: [], company: '虚构公司' }, ...session }))).status, 400)
  assert.equal(calls, 0)
})
test('browser cannot replace production secrets', async () => {
  const handler = createHostedHandler(config)
  const session = await login(handler)
  assert.equal((await handler(request('resume-ai/configure', { method: 'POST', body: { action: 'save', apiKey: 'not-a-real-key' }, ...session }))).status, 409)
})
test('logout removes the browser session cookie', async () => {
  const handler = createHostedHandler(config)
  const session = await login(handler)
  const response = await handler(request('session/logout', { method: 'POST', body: {}, ...session }))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/u)
})
test('repeated failed logins are temporarily limited', async () => {
  const handler = createHostedHandler(config)
  for (let i = 0; i < 8; i++) assert.equal((await handler(request('session/login', { method: 'POST', body: { password: 'incorrect' } }))).status, 401)
  assert.equal((await handler(request('session/login', { method: 'POST', body: { password: 'incorrect' } }))).status, 429)
})
test('single-instance AI limit stops further provider calls', async () => {
  let calls = 0
  const handler = createHostedHandler(config, { fetch: async () => { calls++; return mockFetch() } })
  const session = await login(handler)
  for (let i = 0; i < 12; i++) assert.equal((await handler(request('resume-ai/rewrite', { method: 'POST', body: input, ...session }))).status, 200)
  assert.equal((await handler(request('resume-ai/rewrite', { method: 'POST', body: input, ...session }))).status, 429)
  assert.equal(calls, 12)
})
