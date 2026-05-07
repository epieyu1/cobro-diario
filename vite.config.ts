import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// El alias @ es contrato ergonomico del repo.
// Si se cambia, deben ajustarse imports TS, ESLint y documentacion de asistentes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Las compuertas unitarias de Fase 2 corren en Node porque validan contrato financiero puro.
    // Si una prueba futura necesita DOM, debe documentarlo y mover solo ese caso a jsdom.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
