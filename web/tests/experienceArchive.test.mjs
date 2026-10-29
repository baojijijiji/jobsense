import test from 'node:test'
import assert from 'node:assert/strict'
import { ARCHIVE_KEY, ArchiveError, applyArchiveCommand, readArchive, searchExperiences } from '../src/experienceArchive.ts'

function memoryStorage(raw = null) {
  let value = raw
  return {
    getItem(key) { assert.equal(key, ARCHIVE_KEY); return value },
    setItem(key, next) { assert.equal(key, ARCHIVE_KEY); value = next },
    raw() { return value },
  }
}

const input = {
  title: '测试项目', type: '项目', period: '2025.03 — 2025.06',
  organization: '测试团队', role: '研究助理', summary: '整理分析数据。',
  outcome: '形成研究报告。', skills: ['Python', '数据分析'],
}
const time = '2026-10-07T01:00:00.000Z'
function create(storage, id = 'test-id', fields = input) {
  return applyArchiveCommand(storage, { kind: 'create', id, input: fields }, time)
}

test('首次读取提供独立的虚构样例，不在读取时写入', () => {
  const storage = memoryStorage()
  const first = readArchive(storage)
  first.entries[0].title = '修改内存样例'
  assert.equal(storage.raw(), null)
  assert.notEqual(readArchive(storage).entries[0].title, '修改内存样例')
})

test('新建、重新读取和编辑保留稳定编号与创建时间，清理空白/重复关键词', () => {
  const storage = memoryStorage()
  create(storage, 'test-id', { ...input, title: '  测试项目  ', skills: ['Python', 'Python', ' ', ' 数据分析 '] })
  const saved = readArchive(storage).entries.find((item) => item.id === 'test-id')
  assert.equal(saved.title, '测试项目')
  assert.deepEqual(saved.skills, ['Python', '数据分析'])
  const updated = applyArchiveCommand(storage, { kind: 'update', id: saved.id, expectedUpdatedAt: saved.updatedAt, input: { ...input, outcome: '补充真实成果。' } }, time)
  const edited = updated.entries.find((item) => item.id === saved.id)
  assert.equal(edited.createdAt, saved.createdAt)
  assert.ok(edited.updatedAt > saved.updatedAt)
  assert.equal(readArchive(storage).entries.find((item) => item.id === saved.id).outcome, '补充真实成果。')
})

test('移入回收站并刷新后仍保留，恢复后原内容和编号不变', () => {
  const storage = memoryStorage()
  const saved = create(storage).entries[0]
  applyArchiveCommand(storage, { kind: 'trash', id: saved.id, expectedUpdatedAt: saved.updatedAt }, time)
  const trashed = readArchive(storage).entries.find((item) => item.id === saved.id)
  assert.ok(trashed.deletedAt)
  assert.equal(searchExperiences(readArchive(storage).entries, saved.title).length, 0)
  assert.equal(searchExperiences(readArchive(storage).entries, saved.title, '全部', true).length, 1)
  applyArchiveCommand(storage, { kind: 'restore', id: saved.id, expectedUpdatedAt: trashed.updatedAt }, time)
  const restored = readArchive(storage).entries.find((item) => item.id === saved.id)
  assert.equal(restored.deletedAt, null)
  assert.equal(restored.summary, saved.summary)
  assert.equal(restored.createdAt, saved.createdAt)
})

test('已存在的空列表不会重新补入示例数据', () => {
  const storage = memoryStorage(JSON.stringify({ schemaVersion: 1, revision: 9, entries: [] }))
  assert.deepEqual(readArchive(storage).entries, [])
})

test('所有经历在回收站时，刷新后经历库保持为空', () => {
  const storage = memoryStorage()
  for (const item of readArchive(storage).entries) {
    applyArchiveCommand(storage, { kind: 'trash', id: item.id, expectedUpdatedAt: item.updatedAt }, time)
  }
  assert.equal(searchExperiences(readArchive(storage).entries, '').length, 0)
  assert.equal(searchExperiences(readArchive(storage).entries, '', '全部', true).length, 4)
})

test('格式损坏、未知版本、重复编号及缺少字段均阻止写入且保留原始内容', () => {
  const base = readArchive(memoryStorage())
  for (const raw of [
    '{broken-json',
    JSON.stringify({ ...base, schemaVersion: 2 }),
    JSON.stringify({ ...base, entries: [base.entries[0], base.entries[0]] }),
    JSON.stringify({ ...base, entries: [{ ...base.entries[0], summary: null }] }),
  ]) {
    const storage = memoryStorage(raw)
    assert.throws(() => create(storage), (error) => error instanceof ArchiveError && error.code === 'format')
    assert.equal(storage.raw(), raw)
  }
})

test('存储写入失败时保留之前的完整资料，允许原命令重试', () => {
  const storage = memoryStorage()
  const saved = create(storage).entries[0]
  const before = storage.raw()
  const command = { kind: 'update', id: saved.id, expectedUpdatedAt: saved.updatedAt, input: { ...input, title: '新标题' } }
  assert.throws(() => applyArchiveCommand({ ...storage, setItem() { throw new Error('QuotaExceededError') } }, command), (error) => error.code === 'storage')
  assert.equal(storage.raw(), before)
  applyArchiveCommand(storage, command)
  assert.equal(readArchive(storage).entries.find((item) => item.id === saved.id).title, '新标题')
})

test('存储读取被禁止时不能用默认样例覆盖已有资料', () => {
  let writes = 0
  const blocked = { getItem() { throw new Error('SecurityError') }, setItem() { writes += 1 } }
  assert.throws(() => create(blocked), (error) => error.code === 'storage')
  assert.equal(writes, 0)
})

test('同一经历的过期编辑被拒绝，不覆盖其他标签页的修改', () => {
  const storage = memoryStorage()
  const saved = create(storage).entries[0]
  applyArchiveCommand(storage, { kind: 'update', id: saved.id, expectedUpdatedAt: saved.updatedAt, input: { ...input, summary: '另一标签页已更新。' } }, time)
  const before = storage.raw()
  assert.throws(() => applyArchiveCommand(storage, { kind: 'update', id: saved.id, expectedUpdatedAt: saved.updatedAt, input }), (error) => error.code === 'conflict')
  assert.equal(storage.raw(), before)
})

test('编辑时从最新存储合并，保留其他经历的新增', () => {
  const storage = memoryStorage()
  const saved = create(storage).entries[0]
  create(storage, 'another-id')
  applyArchiveCommand(storage, { kind: 'update', id: saved.id, expectedUpdatedAt: saved.updatedAt, input: { ...input, role: '测试角色' } })
  const entries = readArchive(storage).entries
  assert.ok(entries.some((item) => item.id === 'another-id'))
  assert.equal(entries.find((item) => item.id === saved.id).role, '测试角色')
})

test('拒绝空白必填内容及超限字段，不改变已保存资料', () => {
  const storage = memoryStorage()
  const before = storage.raw()
  for (const fields of [{ ...input, title: '  ' }, { ...input, summary: '\n ' }, { ...input, title: '长'.repeat(151) }]) {
    assert.throws(() => create(storage, 'test-id', fields), (error) => error.code === 'invalid')
    assert.equal(storage.raw(), before)
  }
})

test('中文、英文大小写、全角字符、多关键词及角色/成果/单位均可检索', () => {
  const storage = memoryStorage()
  const entries = create(storage).entries
  assert.equal(searchExperiences(entries, '测试项目 ｐｙｔｈｏｎ 研究报告').length, 1)
  assert.equal(searchExperiences(entries, '测试团队 研究助理').length, 1)
  assert.equal(searchExperiences(entries, '测试项目', '科研').length, 0)
  assert.equal(searchExperiences(entries, '测试项目 不存在').length, 0)
})
