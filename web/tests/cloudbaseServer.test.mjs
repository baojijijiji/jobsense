import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
const { createCloudbaseListener, cloudbaseConfig } = await import(process.env.JOBSENSE_CHECK_CLOUDBASE_BUILD === 'true'
  ? '../.cloudbase-build/functions/jobsense/server/cloudbaseServer.js' : '../server/cloudbaseServer.ts')

const origin = 'https://jobsense.example'
const config = { accessPassword: 'test-only-password-123', sessionSecret: 'test-only-session-secret-at-least-32-characters',
  apiKey: 'test-only-not-a-real-key', enabled: true, origins: [origin] }

// In-memory HTTP messages exercise the adapter without opening a port or browser.
class MemoryResponse extends Writable {
  statusCode = 200
  headersSent = false
  headers = new Map()
  chunks = []
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value) }
  writeHead(status, headers) {
    this.statusCode = status
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
    this.headersSent = true
    return this
  }
  _write(chunk, _encoding, done) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); done() }
  text() { return Buffer.concat(this.chunks).toString('utf8') }
  json() { return JSON.parse(this.text()) }
}

async function invoke(listener, url, { method = 'GET', body, headers = {}, chunks } = {}) {
  const request = Readable.from(chunks ?? (body === undefined ? [] : [Buffer.from(JSON.stringify(body))]))
  request.url = url; request.method = method
  request.headers = { ...(method === 'POST' ? { 'content-type': 'application/json', origin } : {}), ...headers }
  const response = new MemoryResponse()
  await listener(request, response)
  if (!response.writableFinished) await new Promise((done, fail) => { response.once('finish', done); response.once('error', fail) })
  return response
}

async function login(listener) {
  const response = await invoke(listener, '/api/session/login', { method: 'POST', body: { password: config.accessPassword } })
  assert.equal(response.statusCode, 200)
  return { cookie: response.headers.get('set-cookie').split(';')[0], 'x-career-csrf': response.json().csrf }
}

test('CloudBase config accepts only an HTTPS root origin and explicit AI enablement', () => {
  for (const address of ['', 'http://jobsense.example', 'https://u:p@jobsense.example', origin + '/subpath', origin + '?x=1', origin + '#a']) {
    assert.deepEqual(cloudbaseConfig({ JOBSENSE_SITE_ORIGIN: address }).origins, [])
  }
  const value = cloudbaseConfig({ JOBSENSE_SITE_ORIGIN: origin + '/', DEEPSEEK_ENABLED: 'true', TENCENTCLOUD_SECRETKEY: 'not-for-app' })
  assert.deepEqual(value.origins, [origin])
  assert.equal(value.enabled, true)
  assert.equal(JSON.stringify(value).includes('not-for-app'), false)
  assert.equal(cloudbaseConfig({ DEEPSEEK_ENABLED: 'false' }).enabled, false)
})

test('CloudBase login and restarted adapter preserve the same secure session', async () => {
  const listener = createCloudbaseListener('.', config)
  const headers = await login(listener)
  const response = await invoke(createCloudbaseListener('.', config), '/api/session/status', { headers })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { authenticated: true, csrf: headers['x-career-csrf'] })
})

test('unauthorized requests, alternate query routes and cross-origin login stay closed', async () => {
  let calls = 0
  const listener = createCloudbaseListener('.', config, { fetch: async () => { calls++; throw new Error('must not call provider') } })
  assert.equal((await invoke(listener, '/api/resume-ai/rewrite', { method: 'POST', body: {} })).statusCode, 401)
  assert.equal((await invoke(listener, '/api/session/status?route=resume-ai/rewrite', { method: 'POST', body: {} })).statusCode, 405)
  assert.equal((await invoke(listener, '/api/unknown?route=session/status')).statusCode, 404)
  assert.equal((await invoke(listener, '/api/session/login', { method: 'POST', body: {}, headers: { origin: 'https://other.example' } })).statusCode, 403)
  assert.equal(calls, 0)
})

test('oversized streamed input returns 413 through the native adapter', async () => {
  const listener = createCloudbaseListener('.', config)
  const headers = await login(listener)
  const chunks = Array.from({ length: 6 }, () => Buffer.alloc(40000, 'a'))
  const response = await invoke(listener, '/api/resume-ai/rewrite', { method: 'POST', headers, chunks })
  assert.equal(response.statusCode, 413)
  assert.match(response.json().error, /请求内容过多/u)
})

test('a disconnected rejected upload cannot crash the server with a late stream error', async () => {
  const listener = createCloudbaseListener('.', config)
  const request = Readable.from([Buffer.alloc(100, 'a')])
  request.url = '/api/resume-ai/rewrite'; request.method = 'POST'
  request.headers = { 'content-type': 'application/json', origin }
  const response = new MemoryResponse()
  await listener(request, response)
  assert.equal(response.statusCode, 401)
  assert.doesNotThrow(() => request.emit('error', new Error('synthetic disconnected upload')))
})

test('platform credential headers do not enter the model payload or status response', async () => {
  const input = { job: '岗位要求数据分析并整理报告。', style: 'concise', selection: 'rank', entries: [
    { id: 'sample-1', title: '虚构分析练习', type: '项目', role: '参与者', summary: '分析数据并整理报告', outcome: '完成8项分析', skills: ['数据分析'] },
  ] }
  const output = { jobFocus: [{ label: '数据分析', quote: '数据分析', priority: 'required' }], entries: [
    { id: 'sample-1', assessment: { level: 'direct', reason: '分析练习符合要求', jobEvidence: ['数据分析'] },
      bullets: [{ text: '分析数据并整理报告', evidence: ['分析数据并整理报告'] }] },
  ] }
  let calls = 0
  const listener = createCloudbaseListener('.', config, { fetch: async (_url, init) => {
    calls++
    assert.equal(JSON.stringify(init).includes('platform-private-value'), false)
    assert.deepEqual(JSON.parse(JSON.parse(init.body).messages[1].content), input)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }))
  } })
  const headers = { ...await login(listener), 'x-cloudbase-credentials': 'platform-private-value', 'x-cloudbase-context': 'platform-private-value' }
  const status = await invoke(listener, '/api/resume-ai/status', { headers })
  assert.equal(status.text().includes('platform-private-value'), false)
  const response = await invoke(listener, '/api/resume-ai/rewrite', { method: 'POST', body: input, headers })
  assert.equal(response.statusCode, 200)
  assert.match(response.json().entries[0].text, /完成8项分析/u)
  assert.equal(calls, 1)
})

test('static files have correct content type; private paths and writes are rejected', async () => {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(resolve(temporaryRoot, 'jobsense-cloudbase-'))
  try {
    await mkdir(resolve(directory, 'public/assets'), { recursive: true })
    await writeFile(resolve(directory, 'public/index.html'), '<h1>synthetic fixture</h1>')
    await writeFile(resolve(directory, 'public/assets/test.js'), 'console.log("fixture")')
    await writeFile(resolve(directory, 'private.txt'), 'not-public')
    const listener = createCloudbaseListener(resolve(directory, 'public'), config)
    const index = await invoke(listener, '/')
    assert.equal(index.statusCode, 200); assert.match(index.text(), /synthetic fixture/u)
    assert.equal(index.headers.get('cache-control'), 'no-store')
    const asset = await invoke(listener, '/assets/test.js', { method: 'HEAD' })
    assert.equal(asset.statusCode, 200); assert.equal(asset.text(), '')
    assert.match(asset.headers.get('content-type'), /javascript/u)
    for (const path of ['/private.txt', '/%2e%2e%2fprivate.txt', '/.env.local', '/server/cloudbaseIndex.js', '/assets/%5cprivate.txt']) {
      assert.equal((await invoke(listener, path)).statusCode, 404)
    }
    assert.equal((await invoke(listener, '/', { method: 'POST', body: {} })).statusCode, 405)
  } finally {
    if (!resolve(directory).startsWith(temporaryRoot + sep)) throw new Error('Unexpected temporary fixture path')
    await rm(directory, { recursive: true, force: true })
  }
})

test('health endpoint reveals no secrets and missing deployment config fails closed', async () => {
  const listener = createCloudbaseListener('.', { ...config, origins: [] })
  const health = await invoke(listener, '/healthz', { headers: { 'x-cloudbase-credentials': 'platform-private-value' } })
  assert.deepEqual(health.json(), { ok: true })
  assert.equal((await invoke(listener, '/api/session/status')).statusCode, 503)
  assert.equal((await invoke(listener, '//untrusted.example/')).statusCode, 400)
})
