const fs = require('fs')
const path = require('path')

// Same target as the frontend: menu photos render at ~112px, so 800px is plenty.
const MAX_SIDE = 800
const WEBP_QUALITY = 78
const RAW_SAFE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])

// sharp is a native module. Load it lazily so a server where `npm install` has not
// been rerun after pulling still boots and accepts uploads (just uncompressed).
let sharp = null
try {
  sharp = require('sharp')
} catch {
  console.warn('⚠️  sharp is not installed; menu images will be stored without server-side compression. Run `npm install` in backend/.')
}

function safeBaseName(originalName) {
  const ext = path.extname(originalName)
  return path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 30) || 'photo'
}

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Write an uploaded image buffer into `dir`, downscaled to MAX_SIDE and re-encoded
 * as WebP with metadata (EXIF/GPS) stripped. Returns the stored file name.
 * Throws an error with `status = 400` when the buffer is not a decodable image.
 */
async function saveMenuImage(buffer, originalName, dir) {
  const base = `${safeBaseName(originalName)}-${uniqueSuffix()}`

  if (!sharp) {
    // Stored as-is and served publicly, so only formats browsers render inertly are
    // allowed here; anything else (SVG with script, HTML renamed .png...) needs sharp.
    const ext = path.extname(originalName).toLowerCase()
    if (!RAW_SAFE_EXTENSIONS.has(ext)) {
      const unsupported = new Error('This image format cannot be processed on this server yet. Please use JPG, PNG or WebP.')
      unsupported.status = 400
      throw unsupported
    }
    const filename = `${base}${ext}`
    await fs.promises.writeFile(path.join(dir, filename), buffer)
    return filename
  }

  const filename = `${base}.webp`
  try {
    await sharp(buffer, { failOn: 'error' })
      .rotate() // apply EXIF orientation before metadata is dropped
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(path.join(dir, filename))
  } catch (error) {
    const invalid = new Error('This file is not an image, or its format is not supported. Try JPG, PNG, WebP, AVIF, GIF, TIFF or SVG.')
    invalid.status = 400
    invalid.cause = error
    throw invalid
  }
  return filename
}

module.exports = { saveMenuImage, MAX_SIDE }
