export const attachmentLimits = { file: 10 * 1024 * 1024, total: 100 * 1024 * 1024, batch: 10 }
export const attachmentKinds = ['pdf', 'md', 'doc', 'docx', 'txt', 'png'] as const
export type AttachmentKind = typeof attachmentKinds[number]
export interface Attachment {
  version: 1
  id: string
  name: string
  kind: AttachmentKind
  size: number
  mime: string
  experienceId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
const mimeTypes: Record<AttachmentKind, string> = {
  pdf: 'application/pdf', png: 'image/png', txt: 'text/plain', md: 'text/plain',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const databaseName = 'career-archive-attachments'
const formatMessage = '附件记录格式异常，请保留浏览器数据。当前暂停写入，未清空原文件。'

export function attachmentMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AttachmentError') return error.message
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '浏览器空间不足，本次操作未保存。请保留原文件，检查设备空间后重试。'
  return '无法读取或保存浏览器附件。请检查浏览器存储权限后重试；未主动清空已有文件。'
}
function fail(message: string): never {
  const error = new Error(message)
  error.name = 'AttachmentError'
  throw error
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
function validateRows(rows: unknown[]): Attachment[] {
  const ids = new Set<string>()
  for (const value of rows) {
    if (!value || typeof value !== 'object') fail(formatMessage)
    const item = value as Attachment
    if (item.version !== 1 || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name || item.name.length > 255
      || !attachmentKinds.includes(item.kind) || item.mime !== mimeTypes[item.kind]
      || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > attachmentLimits.file
      || !(item.experienceId === null || typeof item.experienceId === 'string' && item.experienceId.length > 0)
      || !validDate(item.createdAt) || !validDate(item.updatedAt)
      || !(item.deletedAt === null || validDate(item.deletedAt))) fail(formatMessage)
    ids.add(item.id)
  }
  return rows as Attachment[]
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0 || blocked) { request.transaction?.abort(); return }
      request.result.createObjectStore('metadata', { keyPath: 'id' })
      request.result.createObjectStore('content')
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(Object.assign(new Error('附件存储正在被其他页面使用，请关闭旧页面后重新读取。'), { name: 'AttachmentError' }))
    }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      if (!db.objectStoreNames.contains('metadata') || !db.objectStoreNames.contains('content')) {
        db.close(); reject(Object.assign(new Error(formatMessage), { name: 'AttachmentError' })); return
      }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

// No awaits inside a transaction: all dependent requests are queued in request callbacks.
async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void, abort: (error: unknown) => void) => void): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['metadata', 'content'], mode)
      let value: T
      let failure: unknown
      tx.oncomplete = () => resolve(value)
      tx.onabort = () => reject(failure ?? tx.error)
      const abort = (error: unknown) => { failure = error; tx.abort() }
      try { work(tx, (result) => { value = result }, abort) } catch (error) { abort(error) }
    })
  } finally { db.close() }
}

export function listAttachments(): Promise<Attachment[]> {
  return transaction('readonly', (tx, result, abort) => {
    const request = tx.objectStore('metadata').getAll()
    request.onsuccess = () => {
      try { result(validateRows(request.result).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) }
      catch (error) { abort(error) }
    }
  })
}

export function decodeAttachmentText(bytes: ArrayBuffer): string {
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2))
  if (header[0] === 255 && header[1] === 254) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes)
  if (header[0] === 254 && header[1] === 255) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes)
  if (new Uint8Array(bytes).includes(0)) fail('TXT/MD 包含二进制数据，无法作为文字文件保存。')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(bytes) }
}
async function prepare(file: File, experienceId: string | null): Promise<{ item: Attachment; blob: Blob }> {
  if (!file.name || file.name.length > 255) fail('文件名需要在 1–255 个字符内。')
  const extension = file.name.split('.').pop()?.toLowerCase() as AttachmentKind
  if (!attachmentKinds.includes(extension)) fail(file.name + '：仅支持 PDF、MD、DOC、DOCX、TXT、PNG。')
  if (!file.size) fail(file.name + '：文件为空，未保存。')
  if (file.size > attachmentLimits.file) fail(file.name + '：超过单文件 10 MiB 上限。')
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const valid = extension === 'pdf' ? starts([37, 80, 68, 70, 45])
    : extension === 'png' ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : extension === 'doc' ? starts([208, 207, 17, 224, 161, 177, 26, 225])
    : extension === 'docx' ? starts([80, 75, 3, 4]) : true
  if (!valid) fail(file.name + '：文件头与扩展名不符，请选择原始文件。')
  if (extension === 'txt' || extension === 'md') {
    try { decodeAttachmentText(await file.arrayBuffer()) }
    catch (error) { fail(file.name + '：' + (error instanceof Error && error.name === 'AttachmentError' ? error.message : '无法读取文字编码，请另存为 UTF-8 后重试。')) }
  }
  const now = new Date().toISOString()
  const item: Attachment = { version: 1, id: crypto.randomUUID(), name: file.name, kind: extension, size: file.size,
    mime: mimeTypes[extension], experienceId, createdAt: now, updatedAt: now, deletedAt: null }
  return { item, blob: file.slice(0, file.size, item.mime) }
}

export async function saveAttachments(files: File[], experienceId: string | null): Promise<void> {
  if (!files.length || files.length > attachmentLimits.batch) fail('每次请选择 1–10 个文件。')
  if (experienceId !== null && !experienceId.trim()) fail('请选择有效经历或暂不关联。')
  const prepared = await Promise.all(files.map((file) => prepare(file, experienceId)))
  await transaction<void>('readwrite', (tx, result, abort) => {
    const metadata = tx.objectStore('metadata')
    const request = metadata.getAll()
    request.onsuccess = () => {
      try {
        const rows = validateRows(request.result)
        const total = [...rows, ...prepared.map(({ item }) => item)].reduce((sum, item) => sum + item.size, 0)
        if (total > attachmentLimits.total) fail('超过本地附件总容量 100 MiB（包含回收站）。本批未保存，请减少文件。')
        for (const { item, blob } of prepared) {
          metadata.add(item)
          tx.objectStore('content').add(blob, item.id)
        }
        result(undefined)
      } catch (error) { abort(error) }
    }
  })
}

export function changeAttachment(item: Attachment, change: { experienceId: string | null } | { deleted: boolean }): Promise<void> {
  return transaction<void>('readwrite', (tx, result, abort) => {
    const store = tx.objectStore('metadata')
    const request = store.getAll()
    request.onsuccess = () => {
      try {
        const latest = validateRows(request.result).find((row) => row.id === item.id)
        if (!latest || latest.updatedAt !== item.updatedAt) fail('文件已被其他页面修改，请关闭当前窗口，重新打开后再操作。')
        const now = new Date(Math.max(Date.now(), Date.parse(latest.updatedAt) + 1)).toISOString()
        const updated = { ...latest, updatedAt: now }
        if ('deleted' in change) updated.deletedAt = change.deleted ? now : null
        else {
          if (latest.deletedAt) fail('请先恢复附件，再修改关联。')
          if (change.experienceId !== null && !change.experienceId.trim()) fail('请选择有效经历或暂不关联。')
          updated.experienceId = change.experienceId
        }
        store.put(updated)
        result(undefined)
      } catch (error) { abort(error) }
    }
  })
}

export function readAttachment(id: string): Promise<{ item: Attachment; blob: Blob }> {
  return transaction('readonly', (tx, result, abort) => {
    const metadata = tx.objectStore('metadata').get(id)
    const content = tx.objectStore('content').get(id)
    let loaded = 0
    const finish = () => {
      if (++loaded !== 2) return
      try {
        const [item] = validateRows([metadata.result])
        const blob: unknown = content.result
        if (!(blob instanceof Blob) || blob.size !== item.size || blob.type !== item.mime) fail('原文件缺失或格式异常，请保留浏览器数据与原始文件后重试。')
        result({ item, blob })
      } catch (error) { abort(error) }
    }
    metadata.onsuccess = finish
    content.onsuccess = finish
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MiB'
}
