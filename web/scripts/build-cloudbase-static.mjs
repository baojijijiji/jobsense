import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const environment = { ...process.env, VITE_CLOUDBASE_MODE: 'true', VITE_HOSTED_MODE: 'false' }
const commands = [
  [resolve(root, 'scripts/copy-pdf-assets.mjs')],
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-b'],
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'],
]
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: environment })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('CloudBase static site built with account login and CloudBase experience sync.')
