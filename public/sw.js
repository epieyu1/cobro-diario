const CACHE_NAME = 'cobro-diario-shell-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg']

// Este service worker solo protege el shell y navegacion basica offline.
// No confirma escrituras, no hace Background Sync y no sustituye la cola transaccional.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Limpiamos versiones viejas del shell para no servir assets obsoletos despues de un deploy.
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  if (event.request.mode === 'navigate') {
    // En navegacion preferimos red y caemos al shell cacheado si no hay conectividad.
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        return cache.match('/') || Response.error()
      }),
    )
    return
  }

  const requestUrl = new URL(event.request.url)

  if (requestUrl.origin !== self.location.origin) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Para assets del mismo origen usamos cache-first con refresh oportunista.
      // Es suficiente para bootstrap, pero no es una politica segura para datos de negocio.
      const networkFetch = fetch(event.request)
        .then(async (networkResponse) => {
          const cache = await caches.open(CACHE_NAME)
          cache.put(event.request, networkResponse.clone())
          return networkResponse
        })
        .catch(() => cachedResponse)

      return cachedResponse || networkFetch
    }),
  )
})
