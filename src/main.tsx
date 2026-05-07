import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App.tsx'
import { registerServiceWorker } from '@/lib/pwa/register-service-worker.ts'
import './index.css'

// El service worker es soporte operativo offline del shell.
// No confirma persistencia de negocio ni reemplaza la sincronizacion con Supabase.
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
