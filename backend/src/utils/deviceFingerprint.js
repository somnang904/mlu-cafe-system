const crypto = require('crypto')

function resolveRequestFingerprint(req) {
  const header = String(req.get?.('x-device-id') || req.headers?.['x-device-id'] || '')
    .trim()
    .toLowerCase()

  if (/^[a-f0-9]{64}$/.test(header)) return header

  const userAgent = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '')
  const language = String(req.get?.('accept-language') || req.headers?.['accept-language'] || '')
  return crypto.createHash('sha256').update(`${userAgent}|${language}|${header}`).digest('hex')
}

// The app sends a random per-browser id as a 64-hex X-Device-Id. Anything else (curl, scripts,
// old clients) has no real device identity, only a hash of its User-Agent.
function hasStrongDeviceId(req) {
  const header = String(req.get?.('x-device-id') || req.headers?.['x-device-id'] || '')
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(header)
}

// Loopback and private addresses are not a person: behind a misconfigured proxy every visitor
// shows up as 127.0.0.1, so blocking one would lock out the whole shop.
function isPrivateOrLoopbackIp(ip) {
  const value = String(ip || '').trim().toLowerCase().replace(/^::ffff:/, '')
  if (!value) return true
  if (value === '::1' || value === 'localhost') return true
  if (/^fe80:/.test(value) || /^f[cd][0-9a-f]{2}:/.test(value)) return true
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

function parseUserAgent(userAgent) {
  const raw = String(userAgent || '').slice(0, 512)
  let browser = 'Unknown'
  if (/Edg\//.test(raw)) browser = 'Edge'
  else if (/OPR\//.test(raw) || /Opera/.test(raw)) browser = 'Opera'
  else if (/Chrome\//.test(raw)) browser = 'Chrome'
  else if (/Firefox\//.test(raw)) browser = 'Firefox'
  else if (/Safari\//.test(raw)) browser = 'Safari'

  let osName = 'Unknown'
  if (/Windows/.test(raw)) osName = 'Windows'
  else if (/Android/.test(raw)) osName = 'Android'
  else if (/iPhone|iPad|iPod/.test(raw)) osName = 'iOS'
  else if (/Mac OS X/.test(raw)) osName = 'macOS'
  else if (/Linux/.test(raw)) osName = 'Linux'

  let deviceType = 'Desktop'
  if (/iPad|Tablet/i.test(raw)) deviceType = 'Tablet'
  else if (/Mobi|Android|iPhone/i.test(raw)) deviceType = 'Mobile'

  return { browser, osName, deviceType, userAgent: raw }
}

module.exports = {
  resolveRequestFingerprint,
  hasStrongDeviceId,
  isPrivateOrLoopbackIp,
  parseUserAgent,
}
