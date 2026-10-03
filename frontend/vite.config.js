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

export default defineConfig({
  plugins: [react(), menuImageDevMiddleware(), omitFullsizeMenuPhotos()],
  server: {
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
