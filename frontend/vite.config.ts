import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Task V2: the voice backend (FastAPI, backend/) serves /api/voice/*. In development Vite proxies
// /api to it so the browser never talks to Gnani directly. VOICE_BACKEND_URL overrides the target.
const voiceBackend = process.env.VOICE_BACKEND_URL ?? 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: voiceBackend, changeOrigin: true },
    },
  },
})
