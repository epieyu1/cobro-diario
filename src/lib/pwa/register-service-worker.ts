const SHELL_CACHE_PREFIX = 'cobro-diario-shell-'

async function clearDevelopmentServiceWorkerState() {
  const registrations = await navigator.serviceWorker.getRegistrations()

  await Promise.all(registrations.map((registration) => registration.unregister()))

  if (!('caches' in window)) {
    return
  }

  const cacheNames = await caches.keys()
  const shellCacheNames = cacheNames.filter((cacheName) => cacheName.startsWith(SHELL_CACHE_PREFIX))

  await Promise.all(shellCacheNames.map((cacheName) => caches.delete(cacheName)))
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener(
    'load',
    () => {
      // Produccion mantiene el shell offline minimo del cobrador.
      // En desarrollo, un SW cacheando assets de Vite puede servir modulos viejos,
      // esconder cambios reales del menu movil y dejar HMR apuntando a un runtime antiguo.
      // Fuente de verdad para validar frontend durante dev: el servidor Vite actual, no el cache offline.
      if (import.meta.env.DEV) {
        void clearDevelopmentServiceWorkerState()
        return
      }

      // Registramos un SW minimo para shell offline.
      // No asumir Background Sync ni confirmacion de negocio por este registro.
      // Si una futura estrategia agrega sync en segundo plano, debe documentarse tambien en public/sw.js.
      void navigator.serviceWorker.register('/sw.js')
    },
    { once: true },
  )
}
