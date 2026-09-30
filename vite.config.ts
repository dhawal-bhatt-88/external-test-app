import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const base = '/external-test-app/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // Local test API (server/index.mjs). Same-origin from the browser's
    // point of view, so no CORS setup is needed. The app calls the API under
    // the base (src/api.ts, as on GitHub Pages); the server still serves /api.
    proxy: {
      [`${base}api`]: {
        target: 'http://localhost:5000',
        rewrite: (path) => path.slice(base.length - 1),
      },
      '/api': 'http://localhost:5000',
    },
  },
})
