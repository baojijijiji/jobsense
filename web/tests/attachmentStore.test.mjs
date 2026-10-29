import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { attachmentLimits, attachmentMessage, changeAttachment, decodeAttachmentText, listAttachments, readAttachment, saveAttachments } from '../src/attachmentStore.ts'

// A fresh in-memory factory per test; never connect to the user's browser data.
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
const name = 'career-archive-attachments'
const textFile = (label = '虚构项目.txt', content = '虚构研究说明\nPython 数据分析') => new File([content], label)
const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const fullFile = () => new File([pngHeader, new Uint8Array(attachmentLimits.file - pngHeader.length)], '容量样例.png')
async function rawDatabase(factory = indexedDB, version = 1) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function rawTransaction(work) {
  const db = await rawDatabase()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['metadata', 'content'], 'readwrite')
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
      work(tx)
    })
  } finally { db.close() }
}

test('空附件库不会插入演示文件；保存后重新连接保留元数据与原文件', async () => {
  assert.deepEqual(await listAttachments(), [])
  const file = textFile()
  await saveAttachments([file], 'experience-1')
  const [item] = await listAttachments()
  assert.equal(item.name, file.name)
  assert.equal(item.experienceId, 'experience-1')
  assert.equal(item.mime, 'text/plain')
  assert.equal(item.deletedAt, null)
  const reopened = await readAttachment(item.id)
  assert.equal(reopened.item.id, item.id)
  assert.deepEqual(new Uint8Array(await reopened.blob.arrayBuffer()), new Uint8Array(await file.arrayBuffer()))
})

test('全部允许类型基础文件头校验；大小写扩展名和同名文件保持独立 ID', async () => {
  const fixtures = [textFile('样例.TXT'), textFile('样例.md'), new File(['%PDF-1.7\n'], '样例.pdf'),
    new File([pngHeader], '样例.png'), new File([new Uint8Array([80, 75, 3, 4])], '样例.docx'),
    new File([new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225])], '样例.doc')]
  await saveAttachments(fixtures, null)
  await saveAttachments([textFile('样例.TXT')], null)
  const rows = await listAttachments()
  assert.equal(rows.length, 7)
  assert.equal(new Set(rows.map((item) => item.id)).size, 7)
  assert.deepEqual(new Set(rows.map((item) => item.kind)), new Set(['txt', 'md', 'pdf', 'png', 'docx', 'doc']))
})

test('修改关联、删除、重新读取和恢复保留原件、ID 与创建时间', async () => {
  await saveAttachments([textFile()], null)
  const [original] = await listAttachments()
  await changeAttachment(original, { experienceId: 'experience-2' })
  const [linked] = await listAttachments()
  await changeAttachment(linked, { deleted: true })
  const [trashed] = await listAttachments()
  assert.ok(trashed.deletedAt)
  assert.equal(trashed.experienceId, 'experience-2')
  assert.equal(await (await readAttachment(trashed.id)).blob.text(), await textFile().text())
  await assert.rejects(changeAttachment(trashed, { experienceId: null }), /先恢复/u)
  await changeAttachment(trashed, { deleted: false })
  const [restored] = await listAttachments()
  assert.equal(restored.deletedAt, null)
  assert.equal(restored.id, original.id)
  assert.equal(restored.createdAt, original.createdAt)
  assert.equal(restored.experienceId, 'experience-2')
  await changeAttachment(restored, { experienceId: null })
  assert.equal((await listAttachments())[0].experienceId, null)
})

test('过期关联/删除/恢复被拒绝，不覆盖其他页面的新状态', async () => {
  await saveAttachments([textFile()], null)
  const [original] = await listAttachments()
  await changeAttachment(original, { experienceId: 'new-relation' })
  await assert.rejects(changeAttachment(original, { experienceId: 'stale-relation' }), /其他页面/u)
  await assert.rejects(changeAttachment(original, { deleted: true }), /其他页面/u)
  await assert.rejects(changeAttachment(original, { deleted: false }), /其他页面/u)
  assert.equal((await listAttachments())[0].experienceId, 'new-relation')
})

test('空文件、不支持类型、伪文件头、二进制文字、超长名与单文件超限均不保存整批', async () => {
  await saveAttachments([textFile('已有附件.txt')], null)
  const invalid = [new File([], '空.txt'), textFile('不支持.exe'), textFile('伪.pdf'), textFile('伪.png'),
    textFile('伪.doc'), textFile('伪.docx'), new File([new Uint8Array([0, 10, 50])], '二进制.txt'),
    textFile('长'.repeat(252) + '.txt'), new File([new Uint8Array(attachmentLimits.file + 1)], '超限.png')]
  for (const file of invalid) {
    await assert.rejects(saveAttachments([textFile('本批有效.txt'), file], null))
    assert.equal((await listAttachments()).length, 1)
  }
  await assert.rejects(saveAttachments([], null), /1–10/u)
  await assert.rejects(saveAttachments(Array.from({ length: 11 }, () => textFile()), null), /1–10/u)
  await assert.rejects(saveAttachments([textFile()], '   '), /有效经历/u)
  assert.equal((await listAttachments()).length, 1)
})

test('写入第二个存储区失败会回滚整批元数据与原件，重试可成功', async (t) => {
  await saveAttachments([textFile('已有附件.txt')], null)
  const add = IDBObjectStore.prototype.add
  const mock = t.mock.method(IDBObjectStore.prototype, 'add', function (...args) {
    if (this.name === 'content') throw new DOMException('simulated storage full', 'QuotaExceededError')
    return add.apply(this, args)
  })
  await assert.rejects(saveAttachments([textFile('本批1.txt'), textFile('本批2.txt')], null), (error) => {
    assert.match(attachmentMessage(error), /空间不足/u)
    return true
  })
  mock.mock.restore()
  const rows = await listAttachments()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, '已有附件.txt')
  assert.equal(await (await readAttachment(rows[0].id)).blob.text(), await textFile().text())
  await saveAttachments([textFile('重试.txt')], null)
  assert.equal((await listAttachments()).length, 2)
})

test('损坏元数据和未知记录版本暂停写入，原记录保持不变', async () => {
  await saveAttachments([textFile()], null)
  const [original] = await listAttachments()
  for (const corrupt of [{ ...original, version: 2 }, { ...original, size: -1 }, { ...original, mime: 'text/html' }]) {
    await rawTransaction((tx) => tx.objectStore('metadata').put(corrupt))
    await assert.rejects(listAttachments(), /格式异常/u)
    await assert.rejects(saveAttachments([textFile('新文件.txt')], null), /格式异常/u)
    const db = await rawDatabase()
    const persisted = await new Promise((resolve) => {
      const request = db.transaction('metadata').objectStore('metadata').get(original.id)
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    assert.deepEqual(persisted, corrupt)
  }
})

test('原件缺失或大小/媒体类型不符时拒绝下载，不以空文件伪装成功', async () => {
  await saveAttachments([textFile()], null)
  const [item] = await listAttachments()
  for (const blob of [null, new Blob(['different'], { type: item.mime }), new Blob([await textFile().text()], { type: 'text/html' })]) {
    await rawTransaction((tx) => {
      const store = tx.objectStore('content')
      if (blob === null) store.delete(item.id)
      else store.put(blob, item.id)
    })
    await assert.rejects(readAttachment(item.id), /原文件缺失或格式异常/u)
  }
})

test('总容量边界 100 MiB 可保存，回收站仍计容量，超限整批回滚', async () => {
  await saveAttachments(Array.from({ length: 10 }, fullFile), null)
  const rows = await listAttachments()
  assert.equal(rows.reduce((sum, item) => sum + item.size, 0), attachmentLimits.total)
  await changeAttachment(rows[0], { deleted: true })
  await assert.rejects(saveAttachments([textFile()], null), /100 MiB/u)
  assert.equal((await listAttachments()).length, 10)
  assert.ok((await listAttachments()).find((item) => item.id === rows[0].id).deletedAt)
})

test('两次并发保存由事务串行检查容量，不共同突破总上限', async () => {
  await saveAttachments(Array.from({ length: 9 }, fullFile), null)
  const results = await Promise.allSettled([saveAttachments([fullFile()], null), saveAttachments([fullFile()], null)])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.equal((await listAttachments()).reduce((sum, item) => sum + item.size, 0), attachmentLimits.total)
})

test('数据库权限被拒绝时反馈失败，恢复后原文件可读取', async () => {
  await saveAttachments([textFile()], null)
  const factory = indexedDB
  globalThis.indexedDB = { open() { throw new DOMException('simulated denial', 'SecurityError') } }
  await assert.rejects(listAttachments())
  await assert.rejects(saveAttachments([textFile('未保存.txt')], null))
  globalThis.indexedDB = factory
  assert.equal((await listAttachments()).length, 1)
})

test('UTF-8/BOM、UTF-16 与 GB18030 可解码；HTML 保持普通文本', () => {
  const utf8 = new TextEncoder().encode('中文 English <script>literal</script>')
  assert.equal(decodeAttachmentText(utf8.buffer), '中文 English <script>literal</script>')
  assert.equal(decodeAttachmentText(new Uint8Array([239, 187, 191, ...utf8]).buffer), decodeAttachmentText(utf8.buffer))
  assert.equal(decodeAttachmentText(new Uint8Array([255, 254, 45, 78, 135, 101]).buffer), '中文')
  assert.equal(decodeAttachmentText(new Uint8Array([254, 255, 78, 45, 101, 135]).buffer), '中文')
  assert.equal(decodeAttachmentText(new Uint8Array([214, 208, 206, 196]).buffer), '中文')
  assert.throws(() => decodeAttachmentText(new Uint8Array([0, 65]).buffer), /二进制/u)
})
