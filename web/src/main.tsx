import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CloudAccessGate } from './CloudAccessGate.tsx'
import './glass-theme.css'

const CloudBaseGate = lazy(() => import('./CloudBaseGate.tsx').then((module) => ({ default: module.CloudBaseGate })))
const app = import.meta.env.VITE_CLOUDBASE_MODE === 'true' && !import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim()
  ? <div className="cloud-access"><div className="cloud-access-card"><h1>JobSense</h1><p>请先配置 VITE_CLOUDBASE_ENV_ID 并重新构建。</p></div></div>
  : import.meta.env.VITE_CLOUDBASE_MODE === 'true'
  ? <Suspense fallback={<div className="cloud-access"><div className="cloud-access-card" role="status"><h1>JobSense</h1><p>正在加载账号空间……</p></div></div>}><CloudBaseGate><App /></CloudBaseGate></Suspense>
  : <CloudAccessGate><App /></CloudAccessGate>

createRoot(document.getElementById('root')!).render(
  <StrictMode>{app}</StrictMode>,
)
