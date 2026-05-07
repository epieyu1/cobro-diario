export type BestEffortCoordinates = {
  latitude: number
  longitude: number
}

export async function readBestEffortCoordinates(timeoutMs = 4000): Promise<BestEffortCoordinates | undefined> {
  // GPS es evidencia operativa valiosa, pero V1 no debe bloquear un cobro por ausencia de permiso,
  // hardware o señal. Este helper siempre degrada a "sin coordenadas" en vez de romper la transaccion.
  if (!('geolocation' in navigator)) {
    return undefined
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      () => {
        resolve(undefined)
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: timeoutMs,
      },
    )
  })
}
