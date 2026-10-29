import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceSync, WorkspaceConflict } from '../src/workspaceSync.ts'
import { defaultWorkspace, mergeApplicationImport, validateDocument } from '../src/workspaceSchema.ts'
import { parseTextTransfer } from '../src/textDataTransfer.ts'

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('连续编辑串行保存，晚到的响应不覆盖新文字，版本接续', async () => {
  const first = deferred(); const calls = []
  const store = new WorkspaceSync({ career: 'old' }, { career: 7 }, async (key, value, version) => { calls.push({ key, value, version }); return calls.length === 1 ? first.promise : 9 })
  store.update('career', 'first', 10000); const work = store.flush()
  store.update('career', 'second', 10000); first.resolve(8); await work
  assert.deepEqual(calls.map(({ value, version }) => [value, version]), [['first', 7], ['second', 8]])
  assert.equal(store.getSnapshot().data.career, 'second'); assert.deepEqual(store.getSnapshot().pending, []); store.dispose()
})
test('请求失败保留修改及旧版本，显式重试后成功', async () => {
  let calls = 0; const versions = []
  const store = new WorkspaceSync({ career: 'old' }, { career: 2 }, async (_, value, version) => { versions.push(version); assert.equal(value, 'pending'); if (++calls === 1) throw new Error('offline'); return 3 })
  store.update('career', 'pending', 10000); await assert.rejects(store.flush(), /offline/)
  assert.equal(store.getSnapshot().data.career, 'pending'); assert.deepEqual(store.getSnapshot().pending, ['career'])
  await store.flush(); assert.deepEqual(versions, [2, 2]); assert.equal(store.getSnapshot().versions.career, 3); store.dispose()
})
test('写入期间的失败会取消已经安排的重试，避免隐式重复请求', async () => {
  const pending = deferred(); let calls = 0
  const store = new WorkspaceSync({ career: 'a' }, { career: 1 }, async () => { calls++; return pending.promise })
  store.update('career', 'b', 10000); const work = store.flush()
  store.update('career', 'c', 5); pending.reject(new Error('offline')); await assert.rejects(work)
  await pause(20); assert.equal(calls, 1); assert.equal(store.getSnapshot().data.career, 'c'); store.dispose()
})
test('冲突保留待保存内容，禁止继续覆盖或自动提高版本', async () => {
  let calls = 0
  const store = new WorkspaceSync({ career: 'original' }, { career: 1 }, async () => { calls++; throw new WorkspaceConflict('conflict') })
  store.update('career', 'mine', 10000); await assert.rejects(store.flush(), WorkspaceConflict)
  assert.equal(store.update('career', 'overwrite'), false); await assert.rejects(store.flush(), WorkspaceConflict)
  assert.equal(calls, 1); assert.equal(store.getSnapshot().data.career, 'mine'); assert.equal(store.getSnapshot().versions.career, 1); store.dispose()
})
test('有未保存修改时不允许重新读取并静默丢弃', () => {
  const store = new WorkspaceSync({ career: '' }, { career: null }, async () => 1)
  store.update('career', 'pending', 10000); assert.throws(() => store.reset({ career: 'remote' }, { career: 2 }), /未同步/); store.dispose()
})
test('切换账号销毁旧队列会取消请求，不再发出更新', async () => {
  const first = deferred(); let signal; let changed = 0
  const store = new WorkspaceSync({ career: '' }, { career: null }, async (_, value, version, received) => { signal = received; return first.promise })
  store.subscribe(() => changed++); store.update('career', 'pending', 10000); const work = store.flush()
  const before = changed; store.dispose(); assert.equal(signal.aborted, true); first.resolve(1); await work
  assert.equal(changed, before); assert.equal(store.getSnapshot().versions.career, null)
})
test('新账号的三个文档空间独立，首次写入使用空版本', async () => {
  const calls = []; const store = new WorkspaceSync(defaultWorkspace(), { applications: null, career: null, preferences: null }, async (key, value, version) => { calls.push([key, version]); return 1 })
  store.update('career', { ...defaultWorkspace().career, name: '虚构用户' }, 10000); await store.flush()
  assert.deepEqual(calls, [['career', null]]); assert.equal(store.getSnapshot().versions.preferences, null); store.dispose()
})

function record(id, company = '虚构公司') { return { id, company, position: '测试职位', type: '校招', stage: '已投递', appliedDate: '2026-10-14', createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z' } }
function applications(records) { return { schemaVersion: 1, revision: '', records } }
test('投递导入按稳定编号去重，保持云端已更新内容', () => {
  const result = mergeApplicationImport(applications([record('same', '云端修改')]), applications([record('same', '旧版内容'), record('new')]))
  assert.equal(result.added, 1); assert.equal(result.skipped, 1); assert.equal(result.snapshot.records.find((item) => item.id === 'same').company, '云端修改')
  const retry = mergeApplicationImport(result.snapshot, applications([record('same'), record('new')]))
  assert.equal(retry.added, 0); assert.equal(retry.skipped, 2)
})
test('重复编号与损坏投递资料拒绝导入', () => {
  assert.throws(() => validateDocument('applications', applications([record('same'), record('same')])))
  assert.throws(() => validateDocument('applications', applications([{ ...record('one'), stage: '未知阶段' }])))
})
test('草稿保留完整来源、富文本、栏目、行距与联系方式设置', () => {
  const input = { ...defaultWorkspace().career, name: '虚构姓名', contact: 'test@example.invalid', generated: true, richSections: { 项目经历: '<p><strong>虚构项目</strong></p>' }, lineSpacing: 1.5, contactSize: 14 }
  const draft = validateDocument('career', input)
  assert.deepEqual(draft, input)
  assert.throws(() => validateDocument('career', { ...input, selectedIds: ['missing-source'] }))
})
test('未知迁移类型及非法字体设置拒绝接入账号', () => {
  assert.throws(() => parseTextTransfer(JSON.stringify({ format: 'jobsense-text-transfer', version: 1, data: { password: 'fake' } })), /未知/)
  assert.throws(() => validateDocument('preferences', { theme: 'gold', typography: { ...defaultWorkspace().preferences.typography, uiScale: 9 } }))
})
test('文字迁移 JSON 校验通过，超过每文档容量拒绝', () => {
  const incoming = { format: 'jobsense-text-transfer', version: 1, data: { career: defaultWorkspace().career, applications: applications([record('one')]) } }
  const transfer = parseTextTransfer(JSON.stringify(incoming)); assert.equal(transfer.data.applications.records.length, 1)
  assert.throws(() => validateDocument('career', { ...defaultWorkspace().career, jobText: '大'.repeat(400000) }), /过大/)
})
