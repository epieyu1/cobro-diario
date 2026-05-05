export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    // Registramos un SW minimo para shell offline.
    // No asumir Background Sync ni confirmacion de negocio por este registro.
    void navigator.serviceWorker.register('/sw.js')
  })
}
