// A random 64-hex id kept in this browser and sent as X-Device-Id.
// It is generated with getRandomValues, which also works over plain http: the site is served
// without https, where crypto.subtle (and randomUUID) do not exist. The server only trusts a
// 64-hex id as a real device identity, so it must always be exactly that shape.
const STORAGE_KEY = 'mlu_device_id'
const DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/

// Used only when localStorage is unavailable (private mode): still unique per device, never a shared constant.
let memoryDeviceId = null

function randomDeviceId() {
  const bytes = new Uint8Array(32)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readDeviceId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing && DEVICE_ID_PATTERN.test(existing)) return existing
    const created = randomDeviceId()
    localStorage.setItem(STORAGE_KEY, created)
    return created
  } catch {
    memoryDeviceId ||= randomDeviceId()
    return memoryDeviceId
  }
}

export async function getDeviceFingerprint() {
  return readDeviceId()
}

export async function deviceHeaders() {
  const fingerprint = await getDeviceFingerprint()
  return fingerprint ? { 'X-Device-Id': fingerprint } : {}
}
