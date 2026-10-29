import { accountAuth, accountFrom, cloudbaseEnvironment } from './cloudbaseAccount'
import { defaultWorkspace, documentKeys, validateDocument, type DocumentKey, type WorkspaceData } from './workspaceSchema'
import { WorkspaceConflict, type Versions } from './workspaceSync'

const fields = 'user_id,document_key,content,version,updated_at'
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
async function request(accountId: string, params: URLSearchParams, method: 'GET' | 'POST' | 'PATCH', signal: AbortSignal, body?: unknown) {
  const result = await accountAuth.getSession(); const session = result.data.session
  if (result.error || accountFrom(session?.user)?.id !== accountId || !session?.access_token) throw new Error('登录状态已变化，请重新登录。')
  signal.throwIfAborted()
  const response = await fetch(`https://${cloudbaseEnvironment}.api.tcloudbasegateway.com/v1/rdb/rest/jobsense_documents?${params}`, {
    method, credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Prefer: 'return=representation' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => { signal.throwIfAborted(); throw new Error('文字资料暂时无法连接云端，修改保留在当前页面；请重试保存。') })
  if (response.status === 409) throw new WorkspaceConflict('资料已在其他设备创建或修改。')
  if (response.status === 401) throw new Error('登录已过期；本页未同步修改可先导出备份，再重新登录。')
  if (!response.ok) throw new Error('云端文字资料暂不可用，请确认已执行 002_text_documents.sql 并保留行级权限。')
  const rows: unknown = response.status === 204 ? [] : await response.json()
  if (!Array.isArray(rows) || rows.length > 3) throw new Error('云端文字资料返回格式异常。')
  return rows
}
function checkedRow(value: unknown, accountId: string) {
  if (!value || typeof value !== 'object') throw new Error('文字资料返回格式异常。')
  const row = value as { user_id: string; document_key: DocumentKey; content: unknown; version: number; updated_at: string }
  if (row.user_id !== accountId || !documentKeys.includes(row.document_key) || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.updated_at))) throw new Error('文字资料归属或版本校验失败，已停止显示。')
  return { key: row.document_key, content: validateDocument(row.document_key, row.content), version: row.version }
}
export async function loadCloudDocuments(accountId: string, signal: AbortSignal) {
  const params = new URLSearchParams({ select: fields, user_id: `eq.${accountId}`, limit: '4' })
  const rows = await request(accountId, params, 'GET', signal)
  const data = defaultWorkspace(); const versions: Versions<WorkspaceData> = { applications: null, career: null, preferences: null }
  for (const raw of rows) {
    const row = checkedRow(raw, accountId)
    if (versions[row.key] !== null) throw new Error('账号文字资料编号重复。')
    Object.assign(data, { [row.key]: row.content }); versions[row.key] = row.version
  }
  return { data, versions }
}
export async function saveCloudDocument<K extends DocumentKey>(accountId: string, key: K, value: WorkspaceData[K], version: number | null, signal: AbortSignal): Promise<number> {
  const content = validateDocument(key, value)
  const params = new URLSearchParams({ select: fields })
  if (version !== null) { params.set('user_id', `eq.${accountId}`); params.set('document_key', `eq.${key}`); params.set('version', `eq.${version}`) }
  try {
    const rows = await request(accountId, params, version === null ? 'POST' : 'PATCH', signal,
      version === null ? { document_key: key, content } : { content })
    if (rows.length === 1) {
      const row = checkedRow(rows[0], accountId)
      if (row.key !== key || (version !== null && row.version <= version) || canonical(row.content) !== canonical(content)) throw new Error('云端保存结果校验失败。')
      return row.version
    }
  } catch (cause) { if (!(cause instanceof WorkspaceConflict)) throw cause }
  // A previous request may have committed even when its response was lost. Accept only identical content.
  const remote = await loadCloudDocuments(accountId, signal)
  if (remote.versions[key] !== null && canonical(remote.data[key]) === canonical(content)) return remote.versions[key]!
  throw new WorkspaceConflict('这类资料已在其他设备修改，本次未覆盖。请导出待保存修改，再重新读取云端版本。')
}
