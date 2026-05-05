import { useEffect, useMemo, useState } from 'react'
import { localDb } from '@/lib/db/local-db.ts'
import { env, hasSupabaseEnv } from '@/lib/env.ts'
import { formatCurrency } from '@/lib/finance/money.ts'
import { getSupabaseBrowserClient } from '@/lib/supabase/client.ts'

type RuntimeCard = {
  label: string
  value: string
  tone: 'ready' | 'warn'
}

const deliveryChecklist = [
  'Git local inicializado para flujo con GitHub.',
  'Supabase local inicializado con migracion base y RLS.',
  'Clientes Supabase, Dexie y React Query listos para integrar casos de uso.',
  'MCP de Vercel y Supabase preparado a nivel de repo; GitHub documentado para alta global.',
]

const nextSteps = [
  'Vincular el proyecto de Supabase real y generar tipos desde el esquema final.',
  'Crear el proyecto en Vercel y conectar el repo de GitHub para previews por rama.',
  'Definir reglas financieras de negocio antes de ampliar el RPC de registro de pagos.',
  'Cerrar autenticacion MCP en GitHub, Vercel y Supabase y reiniciar Codex para detectar los servidores.',
]

function App() {
  // Este estado solo refleja capacidad operativa del navegador.
  // No debe confundirse con confirmacion de persistencia remota.
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [dbReady, setDbReady] = useState(false)
  const supabaseClient = getSupabaseBrowserClient()

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    // Abrimos IndexedDB al montar para verificar que la capa offline esta disponible.
    // La verdad final del negocio sigue viviendo en Supabase.
    void localDb
      .open()
      .then(() => setDbReady(true))
      .catch(() => setDbReady(false))

    return () => {
      localDb.close()
    }
  }, [])

  const runtimeCards = useMemo<RuntimeCard[]>(
    () => [
      {
        label: 'Supabase browser client',
        // El cliente solo se considera listo cuando existen variables publicables.
        // Nunca se debe intentar mover service_role a esta capa.
        value: hasSupabaseEnv && supabaseClient ? 'Configurado' : 'Falta .env',
        tone: hasSupabaseEnv && supabaseClient ? 'ready' : 'warn',
      },
      {
        label: 'IndexedDB local',
        value: dbReady ? 'Disponible' : 'Pendiente',
        tone: dbReady ? 'ready' : 'warn',
      },
      {
        label: 'Service Worker',
        value: 'serviceWorker' in navigator ? 'Soportado' : 'No soportado',
        tone: 'serviceWorker' in navigator ? 'ready' : 'warn',
      },
      {
        label: 'Estado de red',
        value: isOnline ? 'En linea' : 'Offline',
        tone: isOnline ? 'ready' : 'warn',
      },
    ],
    [dbReady, isOnline, supabaseClient],
  )

  return (
    <main className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Cobro Diario</p>
          <h1>Base profesional para una WebApp de recaudo offline-first</h1>
          <p className="lead">
            El repositorio ya quedo listo para trabajar con Git, GitHub, Vercel y Supabase sin
            mezclar decisiones de producto con improvisacion tecnica.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="/docs/mcp-setup.md">
              Ver guia MCP
            </a>
            <a className="button secondary" href="/docs/architecture.md">
              Revisar arquitectura
            </a>
          </div>
        </div>

        <aside className="hero-metrics" aria-label="Resumen de estado">
          <article className="metric-card">
            <span className="metric-label">Moneda base</span>
            <strong>{env.defaultCurrency}</strong>
            <span>{formatCurrency(125000, env.defaultCurrency, env.defaultLocale)}</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Locale inicial</span>
            <strong>{env.defaultLocale}</strong>
            <span>Preparado para Colombia</span>
          </article>
          <article className="metric-card">
            <span className="metric-label">Modo de despliegue</span>
            <strong>GitHub + Vercel</strong>
            <span>Supabase como backend transaccional</span>
          </article>
        </aside>
      </section>

      <section className="panel-grid" aria-label="Estado de runtime">
        {runtimeCards.map((card) => (
          <article key={card.label} className={`status-card ${card.tone}`}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <p className="section-kicker">Ya resuelto</p>
            <h2>Fundacion del proyecto</h2>
          </div>
          <ul className="list">
            {deliveryChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <p className="section-kicker">Siguiente iteracion</p>
            <h2>Trabajo recomendado</h2>
          </div>
          <ul className="list">
            {nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  )
}

export default App
