const STORAGE_KEY = 'mlu_device_client_id'

let fingerprintPromise = null
// Used only when localStorage is unavailable (private mode): still unique per device, never a shared constant.
let memoryClientId = null

function readClientId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing
    const created = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    memoryClientId ||= globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    return memoryClientId
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Stable device id for the X-Device-Id header.
 * SHA-256(User-Agent + Accept-Language + a localStorage id).
 */
export function getDeviceFingerprint() {
  if (!fingerprintPromise) {
    fingerprintPromise = (async () => {
      const clientId = readClientId()
      const material = `${navigator.userAgent}|${navigator.language || ''}|${clientId}`
      try {
        if (globalThis.crypto?.subtle) return await sha256Hex(material)
      } catch {
        // The raw id is still hashed on the server when it is not 64 hex chars.
      }
      return clientId
    })()
  }
  return fingerprintPromise
}

export async function deviceHeaders() {
  const fingerprint = await getDeviceFingerprint()
  return fingerprint ? { 'X-Device-Id': fingerprint } : {}
}
