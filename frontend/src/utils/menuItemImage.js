export const MENU_IMAGE_PLACEHOLDER = '/menu-images/placeholder.jpg'
export const MENU_IMAGE_THUMB_DIR = '/menu-images/thumbs'

/**
 * POS cards display photos at ~64px. Originals in /menu-images are often 2–5 MB
 * each, so list views always request the matching 256px WebP thumb instead.
 * Remote URLs and already-thumb paths are left alone.
 */
export function resolveMenuImageSrc(imageUrl) {
  const trimmed = String(imageUrl ?? '').trim()
  if (!trimmed) return MENU_IMAGE_PLACEHOLDER

  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith(MENU_IMAGE_THUMB_DIR)) return trimmed
  if (trimmed === MENU_IMAGE_PLACEHOLDER) return trimmed

  const menuMatch = trimmed.match(/^\/menu-images\/([^/]+)\.(jpe?g|png|webp)$/i)
  if (menuMatch) {
    return `${MENU_IMAGE_THUMB_DIR}/${menuMatch[1]}.webp`
  }

  if (trimmed.startsWith('/api/uploads/') || trimmed.startsWith('/uploads/')) {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5500/api'
    const origin = apiBase.startsWith('http') ? new URL(apiBase).origin : ''
    const normalized = trimmed.startsWith('/api') ? trimmed : `/api${trimmed}`
    return `${origin}${normalized}`
  }

  return trimmed
}

export function resolveMenuImageFallback(imageUrl) {
  const trimmed = String(imageUrl ?? '').trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // Camera originals are 2–7 MB. List views must never fall back to them.
  return MENU_IMAGE_PLACEHOLDER
}
