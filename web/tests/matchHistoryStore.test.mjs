import test from 'node:test'
import assert from 'node:assert/strict'
import { MatchHistoryStore } from '../src/matchHistoryStore.ts'
import { blankCareerDraft } from '../src/careerDraft.ts'
import { defaultTypography } from '../src/typography.ts'
import { historyDraftIsAligned, reviseMatching } from '../src/historyDraft.ts'
import { normalizeHistorySnapshot } from '../src/matchHistory.ts'
import { validateDocument } from '../src/workspaceSchema.ts'
import { parseTextTransfer } from '../src/textDataTransfer.ts'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const job = '虚构岗位：测试工程师，负责接口和页面验证。'
const draft = () => ({ ...blankCareerDraft(), generated: true, jobText: job, matchedJob: job })
const snapshot = () => ({ draft: draft(), typography: { ...defaultTypography }, photoDataUrl: '' })
const input = (id = uuid(1)) => ({ id, title: '虚构测试岗', snapshot: snapshot(), expectedVersion: null })
const record = (id = uuid(1), version = 1) => ({ id, title: '虚构测试岗', createdAt: '2026-10-24T01:00:00Z', updatedAt: '2026-10-24T01:00:00Z', version, original: snapshot(), current: snapshot() })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const repo = (overrides = {}) => ({ list: async () => [], load: async (id) => record(id), save: async ({ id }) => record(id), ...overrides })

test('保存途中冻结初版并阻止第二次写入，编辑工作区不会串入请求', async () => {
  const wait = deferred(); let received; let count = 0
  const store = new MatchHistoryStore(repo({ save: async (data) => { received = data; count++; return wait.promise } }))
  const value = input(); const work = store.save(value)
  value.snapshot.draft.sections['项目经历'] = '请求发出后的编辑'
  assert.equal(received.snapshot.draft.sections['项目经历'], '')
  assert.equal(await store.save(input(uuid(2))), null)
  wait.resolve(record()); await work
  assert.equal(count, 1); assert.equal(store.getSnapshot().pending, null); store.dispose()
})

test('保存失败保留原请求，重试使用同一ID和期望版本', async () => {
  const calls = []; const store = new MatchHistoryStore(repo({ save: async (value) => { calls.push(value); if (calls.length === 1) throw new Error('offline'); return record(value.id, 2) } }))
  const value = { ...input(), expectedVersion: 1 }
  assert.equal(await store.save(value), null)
  assert.equal(store.getSnapshot().pending.id, value.id)
  assert.equal(await store.save(input(uuid(2))), null)
  await store.retry()
  assert.deepEqual(calls[0], calls[1]); assert.equal(store.getSnapshot().record.version, 2); store.dispose()
})

test('较慢的列表/详情响应不能覆盖用户后来选择的记录', async () => {
  const older = deferred(); const listing = deferred()
  const store = new MatchHistoryStore(repo({ list: () => listing.promise, load: (id) => id === uuid(1) ? older.promise : Promise.resolve(record(id)) }))
  const refresh = store.refresh(); const first = store.select(uuid(1)); await store.select(uuid(2))
  older.resolve(record(uuid(1))); listing.resolve([]); await Promise.all([refresh, first])
  assert.equal(store.getSnapshot().record.id, uuid(2)); store.dispose()
})

test('账号卸载取消请求并忽略晚到响应，不污染下一个账号', async () => {
  const wait = deferred(); let signal
  const store = new MatchHistoryStore(repo({ save: (_, received) => { signal = received; return wait.promise } }))
  const work = store.save(input()); store.dispose()
  assert.equal(signal.aborted, true); wait.resolve(record()); assert.equal(await work, null)
  const another = new MatchHistoryStore(repo()); assert.equal(another.getSnapshot().record, null); another.dispose()
})

test('保存响应不会被先前正在加载的历史列表覆盖', async () => {
  const listing = deferred(); const store = new MatchHistoryStore(repo({ list: () => listing.promise }))
  const work = store.refresh(); await store.save(input()); listing.resolve([]); await work
  assert.equal(store.getSnapshot().summaries[0].id, uuid(1)); store.dispose()
})

test('同一JD调整候选后拒绝与旧简历合并，重新整理后允许保存', () => {
  const original = draft(); assert.equal(historyDraftIsAligned(original), true)
  const changed = reviseMatching(original, { ...original, skillSelections: ['Python'] })
  assert.equal(historyDraftIsAligned(changed), false)
  assert.equal(historyDraftIsAligned({ ...changed, resumeMatchRevision: changed.matchRevision }), true)
  const textEdit = { ...original, sections: { ...original.sections, 项目经历: '手动修改简历' } }
  assert.equal(historyDraftIsAligned(reviseMatching(original, textEdit)), true)
})

test('切换招聘后重新整理之前不能将旧简历误存成新岗位', () => {
  const original = draft()
  const changed = reviseMatching(original, { ...original, jobText: '新的虚构招聘要求，负责产品分析。', matchedJob: '新的虚构招聘要求，负责产品分析。' })
  assert.equal(changed.resumeJob, original.matchedJob); assert.equal(historyDraftIsAligned(changed), false)
})

test('可保存的大快照含照片调阅后仍能进入当前草稿', () => {
  const value = snapshot(); value.draft.sections['项目经历'] = 'a'.repeat(960000)
  value.photoDataUrl = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(200000)
  const checked = normalizeHistorySnapshot(value)
  assert.doesNotThrow(() => validateDocument('career', { ...checked.draft, historyId: uuid(1), historyVersion: 1, resumePhotoSnapshot: checked.photoDataUrl }))
})

test('跨账号文字导入剥离旧历史链接但保留简历内容', () => {
  const value = { ...draft(), historyId: uuid(1), historyVersion: 7, resumeJob: job }
  const parsed = parseTextTransfer(JSON.stringify({ format: 'jobsense-text-transfer', version: 1, data: { career: value } }))
  assert.equal(parsed.data.career.historyId, undefined); assert.equal(parsed.data.career.historyVersion, undefined)
  assert.equal(parsed.data.career.matchedJob, job)
})
