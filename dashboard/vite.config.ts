import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // CI sets VITE_BASE_PATH to /<repo>/ for GitHub Pages.
  // Local dev and local builds fall back to '/'.
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 3000,
    open: true
  },
  test: {
    environment: 'node',
  },
})
