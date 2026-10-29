import { createHostedHandler } from '../server/hostedGateway.ts'

const origins = [process.env.JOBSENSE_SITE_ORIGIN,
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '',
  process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''].filter((value): value is string => !!value)
  .map((value) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.origin : '' } catch { return '' } }).filter(Boolean)

const handler = createHostedHandler({
  accessPassword: process.env.JOBSENSE_ACCESS_PASSWORD ?? '',
  sessionSecret: process.env.JOBSENSE_SESSION_SECRET ?? '',
  apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
  enabled: process.env.DEEPSEEK_ENABLED !== 'false',
  origins: [...new Set(origins)],
})

export default { fetch: handler }
