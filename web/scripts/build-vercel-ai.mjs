import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z')
const output = resolve(root, '.vercel-ai-build', stamp)
await mkdir(output, { recursive: true })
for (const dir of ['api', 'server', 'public']) await mkdir(resolve(output, dir))
for (const name of ['resumeAi', 'accountAiGateway']) {
  const source = await readFile(resolve(root, 'server', `${name}.ts`), 'utf8')
  const result = ts.transpileModule(source, { fileName: `${name}.ts`, compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true,
  } })
  await writeFile(resolve(output, 'server', `${name}.js`), result.outputText)
}
await writeFile(resolve(output, 'api/ai.js'), `import { createAccountAiHandler } from '../server/accountAiGateway.js'
const handle = createAccountAiHandler({
  environment: process.env.CLOUDBASE_ENV_ID?.trim() ?? '',
  siteOrigin: process.env.JOBSENSE_SITE_ORIGIN?.trim() ?? '',
  apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
  enabled: process.env.DEEPSEEK_ENABLED !== 'false',
})
export default { fetch: handle }
`)
await writeFile(resolve(output, 'package.json'), JSON.stringify({ name: 'jobsense-personal-ai', version: '0.1.0', private: true,
  type: 'module', engines: { node: '22.x' }, scripts: { build: 'node build.mjs' } }, null, 2) + '\n')
await writeFile(resolve(output, 'build.mjs'), "console.log('JobSense AI function source is ready. No local configuration is bundled.')\n")
await writeFile(resolve(output, 'vercel.json'), JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
  buildCommand: 'npm run build', outputDirectory: 'public', regions: ['sin1'],
  functions: { 'api/ai.js': { maxDuration: 120 } },
  rewrites: [{ source: '/api/resume-ai/:action', destination: '/api/ai?action=:action' }],
  headers: [{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] }],
}, null, 2) + '\n')
await writeFile(resolve(output, 'public/index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JobSense AI 后台</title><body style="max-width:680px;margin:12vh auto;padding:24px;font:18px/1.8 system-ui"><h1>JobSense AI 后台已部署</h1><p>这是 JobSense 的 AI 接口后台。网站和账号继续使用腾讯云服务。</p><p>所有已登录且已初始化个人资料的账号都可以使用 AI；调用按账号独立限额，但共享服务器 DeepSeek 密钥，费用由密钥所有者承担。</p><p>此页面只能确认后台已部署；账号连接与模型调用请在 JobSense 网站内验证。</p></body></html>`)
console.log(output)
