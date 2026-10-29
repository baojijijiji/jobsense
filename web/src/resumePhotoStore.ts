const databaseName = 'career-archive-resume-photo'
const storeName = 'photos'
const photoKey = 'resume-photo'
export const resumePhotoLimit = 5 * 1024 * 1024

function fail(message: string): never {
  throw new Error(message)
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onerror = () => reject(new Error('无法打开本机照片存储，请检查浏览器存储权限。'))
    request.onblocked = () => reject(new Error('照片存储正被其他页面使用，请关闭旧页面后重试。'))
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.close()
        reject(new Error('照片存储格式异常，请保留浏览器数据并联系开发者。'))
        return
      }
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

export async function loadResumePhoto(): Promise<Blob | null> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(photoKey)
      request.onsuccess = () => {
        if (request.result === undefined) resolve(null)
        else if (request.result instanceof Blob) resolve(request.result)
        else reject(new Error('本机照片格式异常，未覆盖原数据。'))
      }
      request.onerror = () => reject(new Error('无法读取本机照片，请稍后重试。'))
    })
  } finally { database.close() }
}

export async function decodeResumePhoto(file: File): Promise<{ photo: Blob; bitmap: ImageBitmap }> {
  if (!file.size) fail('照片文件为空，请重新选择。')
  if (file.size > resumePhotoLimit) fail('照片不能超过 5 MiB，请先压缩后再上传。')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const jpeg = starts([0xff, 0xd8, 0xff])
  const png = starts([137, 80, 78, 71, 13, 10, 26, 10])
  const webp = starts([82, 73, 70, 70]) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  const mime = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : ''
  if (!mime || (file.type && file.type !== mime && !(mime === 'image/jpeg' && file.type === 'image/jpg')))
    fail('仅支持有效的 JPG、PNG 或 WebP 图片。')

  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { fail('照片无法打开，请选择完整的 JPG、PNG 或 WebP 图片。') }
  const tooLarge = bitmap.width > 12000 || bitmap.height > 12000 || bitmap.width * bitmap.height > 36_000_000
  if (tooLarge) { bitmap.close(); fail('照片像素过大，请缩小后重新上传。') }

  return { photo: file.slice(0, file.size, mime), bitmap }
}

export async function saveResumePhoto(file: File): Promise<Blob> {
  const { photo, bitmap } = await decodeResumePhoto(file)
  bitmap.close()
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(photo, photoKey)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(new Error('照片保存失败，请检查设备存储空间后重试。'))
      transaction.onabort = () => reject(new Error('照片保存失败，本机原照片仍保留。'))
    })
  } finally { database.close() }
  return photo
}
