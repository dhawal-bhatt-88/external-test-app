import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: "/external-test-app/",
  plugins: [react()],
  server: {
    // Local test API (server/index.mjs). Same-origin from the browser's
    // point of view, so no CORS setup is needed.
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
