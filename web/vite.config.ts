import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { resumeAiPlugin } from './server/resumeAi.ts'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), resumeAiPlugin(loadEnv(mode, process.cwd(), 'DEEPSEEK_'), process.cwd())],
  build: { rollupOptions: { input: { app: resolve(process.cwd(), 'index.html'), account: resolve(process.cwd(), 'account.html') } } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/.env.local', '**/.env.local.pending.local'] } },
}))

