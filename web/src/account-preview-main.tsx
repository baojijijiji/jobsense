import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
const AccountPreview = lazy(() => import('./AccountPreview').then((module) => ({ default: module.AccountPreview })))
import './index.css'
import './glass-theme.css'

createRoot(document.getElementById('root')!).render(<StrictMode>{import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim() ? <Suspense fallback={<p>正在加载账号空间……</p>}><AccountPreview /></Suspense> : <p>请先配置 VITE_CLOUDBASE_ENV_ID 并重新构建。</p>}</StrictMode>)
