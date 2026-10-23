import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * POS cards use /menu-images/thumbs/*.webp. The camera originals in
 * public/menu-images are 2–5 MB each (~93 MB total) and must not ship in dist.
 */
function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))
}

function menuImageDevMiddleware() {
  const apply = (server) => {
    const publicDir = resolve(server.config.root, 'public')
    server.middlewares.use((req, res, next) => {
      const urlPath = decodeURIComponent((req.url || '').split('?')[0])
      if (!urlPath.startsWith('/menu-images/')) return next()

      const file = resolve(publicDir, `.${urlPath}`)
      if (!isInside(publicDir, file)) {
        res.statusCode = 400
        res.end()
        return
      }

      if (!existsSync(file)) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Not found')
        return
      }

      if (urlPath.startsWith('/menu-images/thumbs/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400')
      }

      next()
    })
  }

  return {
    name: 'menu-image-dev-middleware',
    configureServer: apply,
    configurePreviewServer: apply,
  }
}

function omitFullsizeMenuPhotos() {
  return {
    name: 'omit-fullsize-menu-photos',
    async writeBundle(outputOptions) {
      const dir = join(outputOptions.dir, 'menu-images')
      const { readdir } = await import('node:fs/promises')
      let names
      try {
        names = await readdir(dir)
      } catch {
        return
      }
      await Promise.all(
        names
          .filter((name) => name !== 'placeholder.jpg' && /\.(jpe?g|png)$/i.test(name))
          .map((name) => rm(join(dir, name), { force: true })),
      )
    },
  }
}

/**
 * Security headers for the page itself (the API sets its own through helmet).
 * Dev needs inline scripts (React refresh preamble), inline <style> tags (Vite injects CSS
 * that way) and a websocket for HMR. The built app loads only its own bundled files.
 */
const API_ORIGIN = 'http://localhost:5500'

function securityHeaders({ dev }) {
  const csp = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    `img-src 'self' data: blob: ${API_ORIGIN}`,
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN}${dev ? ' ws://localhost:5173' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}

export default defineConfig({
  plugins: [react(), menuImageDevMiddleware(), omitFullsizeMenuPhotos()],
  preview: {
    headers: securityHeaders({ dev: false }),
  },
  server: {
    headers: securityHeaders({ dev: true }),
    // The dev server only serves this app's own page; no other site needs CORS access to it.
    cors: false,
    // Fail loudly instead of silently moving to 5174 when a dev server is already running:
    // a second server on another port is the usual cause of a dev login that will not work.
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5500',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:5500',
        changeOrigin: true,
      },
    },
  },
})
