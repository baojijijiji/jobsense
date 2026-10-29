import { accountAuth, accountFrom, cloudbaseEnvironment } from './cloudbaseAccount'
import { decodeResumePhoto } from './resumePhotoStore'

const fields = 'user_id,image_data,version,updated_at'
const maximumBytes = 192 * 1024
export interface CloudResumePhoto { dataUrl: string; version: number }

function validImageData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 280000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/u.test(value)
}

export async function prepareCloudResumePhoto(file: File): Promise<string> {
  const { bitmap } = await decodeResumePhoto(file)
  const canvas = document.createElement('canvas')
  try {
    let scale = Math.min(1, 600 / bitmap.width, 840 / bitmap.height)
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器暂时无法处理照片，请换一个浏览器重试。')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const compressed = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('照片处理失败，请重新选择。')), 'image/jpeg', 0.88))
      if (compressed.size <= maximumBytes) {
        const value = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取处理后的照片。'))
          reader.onerror = () => reject(new Error('无法读取处理后的照片。'))
          reader.readAsDataURL(compressed)
        })
        if (!validImageData(value)) throw new Error('处理后的照片格式不正确，请选择另一张图片。')
        return value
      }
      scale *= 0.8
    }
    throw new Error('照片压缩后仍过大，请先缩小图片再上传。')
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0 }
}

async function requestPhoto(accountId: string, method: 'GET' | 'POST' | 'PATCH', version: number | null, signal: AbortSignal, imageData?: string) {
  const result = await accountAuth.getSession(); const session = result.data.session
  if (result.error || accountFrom(session?.user)?.id !== accountId || !session?.access_token) throw new Error('登录已变化，请重新登录后上传照片。')
  signal.throwIfAborted()
  const params = new URLSearchParams({ select: fields })
  if (method !== 'POST') { params.set('user_id', 'eq.' + accountId); params.set('limit', '2') }
  if (method === 'PATCH') params.set('version', 'eq.' + version)
  const response = await fetch(`https://${cloudbaseEnvironment}.api.tcloudbasegateway.com/v1/rdb/rest/jobsense_resume_photos?${params}`, {
    method, credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: { Authorization: 'Bearer ' + session.access_token, Accept: 'application/json',
      ...(imageData === undefined ? {} : { 'Content-Type': 'application/json', Prefer: 'return=representation' }) },
    ...(imageData === undefined ? {} : { body: JSON.stringify({ image_data: imageData }) }),
  }).catch(() => { signal.throwIfAborted(); throw new Error('照片暂时无法连接云端，请重试；原照片尚未被本页替换。') })
  if (response.status === 401) throw new Error('登录已过期，请重新登录后上传照片。')
  if (response.status === 409) return null
  if (response.status === 403 || response.status === 404) throw new Error('照片服务或权限尚未准备好，请确认已执行 004_resume_photos.sql，再重新读取照片。')
  if (!response.ok) throw new Error(`云端照片${method === 'GET' ? '读取' : '保存'}失败（HTTP ${response.status}），请稍后重试。`)
  const rows: unknown = response.status === 204 ? [] : await response.json()
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('照片返回格式异常，已停止显示。')
  if (!rows.length) return null
  const row = rows[0] as Record<string, unknown>
  if (!row || row.user_id !== accountId || !validImageData(row.image_data)
    || !Number.isSafeInteger(row.version) || (row.version as number) < 1 || typeof row.updated_at !== 'string'
    || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('照片归属或格式校验失败。')
  return { dataUrl: row.image_data, version: row.version as number }
}

export const loadCloudResumePhoto = (accountId: string, signal: AbortSignal) => requestPhoto(accountId, 'GET', null, signal)

export async function saveCloudResumePhoto(accountId: string, imageData: string, version: number | null, signal: AbortSignal): Promise<CloudResumePhoto> {
  if (!validImageData(imageData)) throw new Error('照片数据不受支持。')
  const saved = await requestPhoto(accountId, version === null ? 'POST' : 'PATCH', version, signal, imageData)
  if (saved) {
    if (saved.dataUrl !== imageData || (version !== null && saved.version <= version)) throw new Error('照片保存结果校验失败，请重新读取。')
    return saved
  }
  // A response may have been lost after a successful save. Only identical data
  // counts as this save; a different photo must never be overwritten on retry.
  const remote = await loadCloudResumePhoto(accountId, signal)
  if (remote?.dataUrl === imageData) return remote
  throw new Error('照片已在其他页面或设备更新。本次没有覆盖，请重新读取后再选择照片。')
}
