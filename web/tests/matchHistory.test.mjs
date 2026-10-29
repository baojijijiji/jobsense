import test from 'node:test'
import assert from 'node:assert/strict'
import { blankCareerDraft } from '../src/careerDraft.ts'
import { defaultTypography } from '../src/typography.ts'
import { normalizeHistorySnapshot, makeHistoryTitle, validateHistoryRecord, validHistoryPhoto, isHistoryId } from '../src/matchHistory.ts'

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function snapshot() {
  return { draft: { ...blankCareerDraft(), generated: true, jobText: '岗位：数据分析师\n负责业务指标分析与数据看板', matchedJob: '岗位：数据分析师\n负责业务指标分析与数据看板', target: '', sections: { ...blankCareerDraft().sections, 项目经历: '虚构项目\n分析并展示数据' } }, typography: { ...defaultTypography }, photoDataUrl: '' }
}
function entry() { return { id, title: '数据分析师', version: 1, createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', original: snapshot(), current: snapshot() } }

test('快照与工作区断开引用，保留原始简历、匹配原文和排版', () => {
  const source = snapshot()
  source.draft.historyId = id; source.draft.historyVersion = 7; source.draft.resumePhotoSnapshot = 'not-persisted-here'
  const saved = normalizeHistorySnapshot(source)
  source.draft.sections.项目经历 = '后续改字'; source.typography.resumeSize = 12
  assert.equal(saved.draft.sections.项目经历, '虚构项目\n分析并展示数据')
  assert.equal(saved.typography.resumeSize, defaultTypography.resumeSize)
  assert.equal(saved.draft.matchedJob, source.draft.matchedJob)
  for (const key of ['historyId', 'historyVersion', 'resumePhotoSnapshot']) assert.equal(Object.hasOwn(saved.draft, key), false)
})

test('original 和 current 独立；修改版不会改变当时生成版', () => {
  const saved = validateHistoryRecord(entry())
  saved.current.draft.sections.项目经历 = '调整后的文字'
  assert.equal(saved.original.draft.sections.项目经历, '虚构项目\n分析并展示数据')
})

test('未生成或招聘与简历不对应时不误存上一份简历', () => {
  const ungenerated = snapshot(); ungenerated.draft.generated = false
  assert.throws(() => normalizeHistorySnapshot(ungenerated), /整理成简历/)
  const mismatch = snapshot(); mismatch.draft.resumeJob = '另一份招聘信息'
  assert.throws(() => normalizeHistorySnapshot(mismatch), /不对应/)
  const editedJob = snapshot(); editedJob.draft.jobText = '修改过的新招聘信息，需要重新分析'
  assert.throws(() => normalizeHistorySnapshot(editedJob), /不对应/)
  const changedSelection = snapshot(); changedSelection.draft.matchRevision = id
  assert.throws(() => normalizeHistorySnapshot(changedSelection), /不对应/)
  changedSelection.draft.resumeMatchRevision = id
  assert.equal(normalizeHistorySnapshot(changedSelection).draft.matchRevision, id)
  const outerWhitespace = snapshot(); outerWhitespace.draft.jobText = '\n  ' + outerWhitespace.draft.jobText + '\t\n'
  assert.equal(normalizeHistorySnapshot(outerWhitespace).draft.jobText, outerWhitespace.draft.matchedJob)
})

test('拒绝损坏选中项、非法字体、照片外链和 SVG 载荷', () => {
  const invalidSelection = snapshot(); invalidSelection.draft.selectedIds = ['unknown']
  assert.throws(() => normalizeHistorySnapshot(invalidSelection))
  const invalidFont = snapshot(); invalidFont.typography.resumeFont = 'external-font'
  assert.throws(() => normalizeHistorySnapshot(invalidFont), /字体/)
  for (const photoDataUrl of ['https://example.invalid/private.jpg', 'data:image/svg+xml,<svg onload="alert(1)"/>', null]) {
    assert.throws(() => normalizeHistorySnapshot({ ...snapshot(), photoDataUrl }))
  }
})

test('照片仅接收适配后的 JPEG data URL，拒绝过大或破损 base64', () => {
  assert.equal(validHistoryPhoto(''), true)
  assert.equal(validHistoryPhoto('data:image/jpeg;base64,/9j/AA=='), true)
  assert.equal(validHistoryPhoto('data:image/jpeg;base64,/9j/A'), false)
  assert.equal(validHistoryPhoto('data:image/jpeg;base64,/9j/' + 'A'.repeat(262144)), false)
})

test('标题优先使用导出岗位名，再取招聘标题；控制字符不会进入标题', () => {
  const input = snapshot()
  assert.equal(makeHistoryTitle(input), '数据分析师')
  input.draft.target = 'AI 产品实习生'
  assert.equal(makeHistoryTitle(input), 'AI 产品实习生')
  input.draft.target = '岗位\u0000名称'
  assert.equal(makeHistoryTitle(input), '岗位 名称')
  input.draft.target = '长'.repeat(121)
  assert.equal(makeHistoryTitle(input).length, 120)
})

test('异常记录版本、日期或编号被拒绝；云端私有内容不接受额外顶层字段', () => {
  assert.equal(isHistoryId(id), true); assert.equal(isHistoryId('eq.user'), false)
  for (const patch of [{ id: 'invalid' }, { version: 0 }, { version: 1.5 }, { createdAt: 'invalid' }, { title: '' }]) assert.throws(() => validateHistoryRecord({ ...entry(), ...patch }))
  const parsed = validateHistoryRecord({ ...entry(), token: 'do-not-carry-forward' })
  assert.equal(Object.hasOwn(parsed, 'token'), false)
})

test('超大草稿拒绝入库，不裁剪或静默丢失用户内容', () => {
  const input = snapshot(); input.draft.sections.项目经历 = '文'.repeat(400000)
  assert.throws(() => normalizeHistorySnapshot(input), /过大/)
})
