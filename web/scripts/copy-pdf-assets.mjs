import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const destination = fileURLToPath(new URL('../public/pdf-assets/', import.meta.url))
mkdirSync(destination, { recursive: true })
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(packageRoot, folder), join(destination, folder), { recursive: true })
}
cpSync(join(packageRoot, 'LICENSE'), join(destination, 'LICENSE'))
