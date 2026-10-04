require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') })

const REQUIRED_VARS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET']

function assertRequiredEnv() {
  const missing = REQUIRED_VARS.filter((key) => {
    const value = process.env[key]
    return value === undefined || value === null || String(value).trim() === ''
  })

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '))
    console.error('   Copy backend/.env.example to backend/.env and set your values.')
    process.exit(1)
  }

  const secret = String(process.env.JWT_SECRET || '')
  const isProduction = process.env.NODE_ENV === 'production'
  const weakSecrets = [
    'secret',
    'changeme',
    'jwt_secret',
    'your_jwt_secret',
    'test',
    'replace_with_a_long_random_secret_key',
    'your_super_secret_key_for_romduol_cafe',
    'your_super_secret_key_for_mlu_kitchen_cafe',
  ]

  if (secret.length < 32 || weakSecrets.includes(secret.toLowerCase())) {
    const note =
      'JWT_SECRET is weak. Use at least 32 random characters ' +
      "(node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\")."
    if (isProduction) {
      console.error(`❌ ${note}`)
      process.exit(1)
    }
    console.warn(`⚠️  ${note}`)
  }

  if (!isProduction) return

  const frontendUrl = String(process.env.FRONTEND_URL || '').trim().replace(/\/$/, '')
  if (!frontendUrl) {
    console.error('❌ FRONTEND_URL is required in production (public HTTPS origin of the React app).')
    process.exit(1)
  }

  let frontendOrigin
  try {
    frontendOrigin = new URL(frontendUrl)
  } catch {
    console.error('❌ FRONTEND_URL must be a valid absolute URL, e.g. https://cafe.example.com')
    process.exit(1)
  }

  if (frontendOrigin.protocol !== 'https:') {
    console.error('❌ FRONTEND_URL must use https:// in production.')
    process.exit(1)
  }

  const host = frontendOrigin.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    console.error('❌ FRONTEND_URL cannot be localhost in production. Set your public site origin.')
    process.exit(1)
  }

  const dbUser = String(process.env.DB_USER || '').trim().toLowerCase()
  if (dbUser === 'root') {
    console.warn('⚠️  DB_USER=root in production. Prefer a dedicated least-privilege MySQL user (see DEPLOYMENT.md).')
  }

  const smtpHost = String(process.env.SMTP_HOST || '').trim()
  const smtpUser = String(process.env.SMTP_USER || '').trim()
  const smtpPass = String(process.env.SMTP_PASS || '').trim()
  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn('⚠️  SMTP is not configured. Reservation confirmation emails will fail until SMTP_* is set.')
  }

  if (String(process.env.TRUST_PROXY || '').toLowerCase() !== 'true') {
    console.warn('⚠️  TRUST_PROXY is not true. Enable it when nginx/Cloudflare terminates TLS in front of Node.')
  }
}

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Comma-separated list, so staging/production can allow more than one dashboard origin. */
function parseOrigins(raw, fallback) {
  const list = String(raw || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return list.length > 0 ? list : fallback
}

const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  port: Number.parseInt(process.env.PORT, 10) || 5500,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME,
  },
  jwtSecret: String(process.env.JWT_SECRET || '').trim(),
  adminEmail: String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  smtp: {
    host: String(process.env.SMTP_HOST || '').trim(),
    port: parseIntOr(process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: String(process.env.SMTP_USER || '').trim(),
    pass: String(process.env.SMTP_PASS || '').trim(),
    from: String(process.env.SMTP_FROM || process.env.ADMIN_EMAIL || 'Mlu Kitchen & Cafe <noreply@localhost>').trim(),
  },
  frontendUrl,
  liveConditions: {
    weatherLat: process.env.WEATHER_LAT,
    weatherLon: process.env.WEATHER_LON,
    weatherLocation: process.env.WEATHER_LOCATION,
  },
  security: {
    // Accept both localhost and 127.0.0.1 when FRONTEND_URL uses either form.
    allowedOrigins: parseOrigins(
      process.env.CORS_ALLOWED_ORIGINS,
      [
        frontendUrl,
        frontendUrl.replace('://localhost', '://127.0.0.1'),
        frontendUrl.replace('://127.0.0.1', '://localhost'),
      ].filter((origin, index, list) => list.indexOf(origin) === index),
    ),
    // Only enable behind a real reverse proxy. If it is on without one, a client can
    // spoof X-Forwarded-For and walk straight past the rate limiter.
    trustProxy: String(process.env.TRUST_PROXY || '').toLowerCase() === 'true',
    loginAttemptLimit: parseIntOr(process.env.LOGIN_ATTEMPT_LIMIT, 10),
    apiRequestLimit: parseIntOr(process.env.API_RATE_LIMIT, 2000),
    sensitiveOperationLimit: parseIntOr(process.env.SENSITIVE_RATE_LIMIT, 20),
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
  },
}

module.exports = {
  env,
  assertRequiredEnv,
}
