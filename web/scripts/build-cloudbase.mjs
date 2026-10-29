import { spawnSync } from 'node:child_process'
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const build = spawnSync(process.execPath, [resolve(root, 'scripts/build-hosted.mjs')], { cwd: root, stdio: 'inherit', env: process.env })
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status ?? 1)
const buildRoot = resolve(root, '.cloudbase-build')
const output = resolve(buildRoot, 'functions/jobsense')
if (!output.startsWith(root + sep) || !output.startsWith(buildRoot + sep)) throw new Error('Unexpected CloudBase build path.')
for (const directory of [buildRoot, resolve(buildRoot, 'functions'), output]) {
  try {
    if ((await lstat(directory)).isSymbolicLink() || !(await realpath(directory)).startsWith(root + sep)) throw new Error('Build directory must stay within the website workspace.')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
await rm(output, { recursive: true, force: true })
await mkdir(resolve(output, 'server'), { recursive: true })
for (const name of ['resumeAi', 'hostedGateway', 'cloudbaseServer', 'cloudbaseIndex']) {
  const source = await readFile(resolve(root, `server/${name}.ts`), 'utf8')
  const result = ts.transpileModule(source, { fileName: `${name}.ts`, compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true,
  } })
  await writeFile(resolve(output, `server/${name}.js`), result.outputText)
}
await cp(resolve(root, 'dist'), resolve(output, 'public'), { recursive: true })
await writeFile(resolve(output, 'index.js'), "import './server/cloudbaseIndex.js'\n")
await writeFile(resolve(output, 'package.json'), JSON.stringify({ name: 'jobsense-cloudbase-runtime', version: '0.1.0', private: true,
  type: 'module', engines: { node: '>=20.19' }, scripts: { start: 'node index.js' } }, null, 2) + '\n')
await writeFile(resolve(output, 'scf_bootstrap'), '#!/bin/bash\nset -e\ncd /var/user\nexec /var/lang/node20/bin/node /var/user/index.js\n', { mode: 0o755 })
console.log('CloudBase runtime built without production npm dependencies or local credentials.')
