import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function shareAssetsDevPlugin(): Plugin {
  const shareRoot = path.resolve(__dirname, 'dist', 'share')
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.html': 'text/html; charset=utf-8',
  }

  return {
    name: 'share-assets-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const base = server.config.base.replace(/\/$/, '')
        let pathname = req.url?.split('?')[0] ?? ''
        if (base && pathname.startsWith(base)) {
          pathname = pathname.slice(base.length) || '/'
        }
        if (!pathname.startsWith('/share/')) {
          next()
          return
        }

        const relativePath = pathname.slice('/share/'.length)
        if (!relativePath || relativePath.includes('..')) {
          next()
          return
        }

        const filePath = path.resolve(shareRoot, relativePath)
        if (filePath !== shareRoot && !filePath.startsWith(`${shareRoot}${path.sep}`)) {
          next()
          return
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next()
          return
        }

        res.setHeader('Content-Type', mimeTypes[path.extname(filePath)] ?? 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), shareAssetsDevPlugin()],
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
