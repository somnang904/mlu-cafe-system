// Menu photos are shown at most ~112px wide, so 800px on the long side keeps them
// sharp on high-DPI screens while turning multi-MB camera photos into ~50-150 KB.
export const MENU_IMAGE_MAX_SIDE = 800
const WEBP_QUALITY = 0.8

// For the file picker. image/* covers what the OS knows; the extensions catch files
// Windows reports without a MIME type (HEIC from iPhones especially).
export const MENU_IMAGE_ACCEPT =
  'image/*,.heic,.heif,.avif,.webp,.jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.svg,.ico,.jfif'

function extensionOf(file) {
  return (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
}

function isHeicFile(file) {
  return /^image\/hei[cf]/.test(file.type) || ['heic', 'heif'].includes(extensionOf(file))
}

function isSvgFile(file) {
  return file.type === 'image/svg+xml' || extensionOf(file) === 'svg'
}

// SVG has no bitmap decoder, so it goes through <img>. Rasterising it here also drops
// any embedded script before the file ever reaches the server.
async function decodeSvg(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const width = img.naturalWidth || MENU_IMAGE_MAX_SIDE
    const height = img.naturalHeight || MENU_IMAGE_MAX_SIDE
    return await createImageBitmap(img, { resizeWidth: width, resizeHeight: height })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function decodeImage(file) {
  if (isHeicFile(file)) {
    // ~3 MB of WebAssembly, so it is only downloaded when someone picks a HEIC photo.
    const { heicTo } = await import('heic-to')
    return heicTo({ blob: file, type: 'bitmap' })
  }
  if (isSvgFile(file)) return decodeSvg(file)
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/**
 * Downscale and re-encode an image file as WebP in the browser.
 * Throws if the browser cannot decode the file (e.g. TIFF in Chrome); callers should
 * then upload the original and let the server convert it.
 */
export async function compressImage(file, { maxSide = MENU_IMAGE_MAX_SIDE, quality = WEBP_QUALITY } = {}) {
  const bitmap = await decodeImage(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob) throw new Error('Image encoding failed')

    // Already-small web-ready originals can come out larger after re-encoding; keep the smaller.
    const webReady = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    if (webReady && blob.size >= file.size && scale === 1) return file

    const ext = blob.type === 'image/webp' ? 'webp' : 'png'
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${baseName}.${ext}`, { type: blob.type })
  } finally {
    bitmap.close?.()
  }
}
