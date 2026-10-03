/**
 * Pre-flight checks before putting the API online.
 * Usage: node scripts/check-production.js
 * Exit 0 = ready (warnings allowed). Exit 1 = blocking failure.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')

const errors = []
const warnings = []

function ok(label, detail = '') {
  console.log(`✔ ${label}${detail ? ` — ${detail}` : ''}`)
}

function warn(label, detail = '') {
  warnings.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`⚠ ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(label, detail = '') {
  errors.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`✘ ${label}${detail ? ` — ${detail}` : ''}`)
}

function required(name) {
  const value = process.env[name]
  if (value === undefined || value === null || String(value).trim() === '') {
    fail(`${name} missing`)
    return ''
  }
  return String(value).trim()
}

async function main() {
  console.log('Production readiness check\n')

  const nodeEnv = String(process.env.NODE_ENV || 'development')
  if (nodeEnv !== 'production') {
    fail('NODE_ENV', `is "${nodeEnv}" (must be production)`)
  } else {
    ok('NODE_ENV', 'production')
  }

  const jwt = required('JWT_SECRET')
  if (jwt) {
    const weak = [
      'secret',
      'changeme',
      'jwt_secret',
      'your_jwt_secret',
      'test',
      'replace_with_a_long_random_secret_key',
      'your_super_secret_key_for_romduol_cafe',
      'your_super_secret_key_for_mlu_kitchen_cafe',
    ]
    if (jwt.length < 32 || weak.includes(jwt.toLowerCase())) {
      fail('JWT_SECRET', 'too weak (need ≥32 random characters)')
    } else {
      ok('JWT_SECRET', `${jwt.length} characters`)
    }
  }

  const dbHost = required('DB_HOST')
  const dbUser = required('DB_USER')
  const dbName = required('DB_NAME')
  const dbPassword = process.env.DB_PASSWORD ?? ''

  if (dbUser.toLowerCase() === 'root') {
    warn('DB_USER=root', 'use a dedicated least-privilege user for production')
  } else if (dbUser) {
    ok('DB_USER', dbUser)
  }

  if (!String(dbPassword).length) {
    warn('DB_PASSWORD empty', 'acceptable only for local Laragon; use a strong password online')
  }

  const frontendUrl = required('FRONTEND_URL')
  if (frontendUrl) {
    try {
      const url = new URL(frontendUrl)
      if (url.protocol !== 'https:') {
        fail('FRONTEND_URL', 'must be https:// in production')
      } else if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
        fail('FRONTEND_URL', 'cannot be localhost for a public site')
      } else {
        ok('FRONTEND_URL', frontendUrl.replace(/\/$/, ''))
      }
    } catch {
      fail('FRONTEND_URL', 'not a valid absolute URL')
    }
  }

  if (String(process.env.TRUST_PROXY || '').toLowerCase() === 'true') {
    ok('TRUST_PROXY', 'true (reverse proxy)')
  } else {
    warn('TRUST_PROXY', 'not true — set true when nginx/Cloudflare terminates TLS')
  }

  const smtpReady = Boolean(
    String(process.env.SMTP_HOST || '').trim()
      && String(process.env.SMTP_USER || '').trim()
      && String(process.env.SMTP_PASS || '').trim(),
  )
  if (smtpReady) {
    ok('SMTP', 'configured')
  } else {
    warn('SMTP', 'not configured — reservation confirmation emails will fail')
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim()
  if (!adminEmail) {
    warn('ADMIN_EMAIL', 'empty')
  } else {
    ok('ADMIN_EMAIL', adminEmail)
  }

  const frontendEnvPath = path.join(__dirname, '..', '..', 'frontend', '.env')
  const frontendEnvProdPath = path.join(__dirname, '..', '..', 'frontend', '.env.production')
  let viteApi = ''
  for (const file of [frontendEnvProdPath, frontendEnvPath]) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const match = text.match(/^VITE_API_URL=(.+)$/m)
    if (match) {
      viteApi = match[1].trim()
      break
    }
  }
  if (!viteApi) {
    fail('VITE_API_URL', 'not found in frontend/.env or frontend/.env.production')
  } else {
    try {
      const url = new URL(viteApi)
      if (url.protocol !== 'https:') {
        fail('VITE_API_URL', `must be https:// before building for production (got ${viteApi})`)
      } else if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
        fail('VITE_API_URL', 'cannot be localhost for a public build')
      } else if (!viteApi.replace(/\/$/, '').endsWith('/api')) {
        warn('VITE_API_URL', `should usually end with /api (got ${viteApi})`)
      } else {
        ok('VITE_API_URL', viteApi)
      }
    } catch {
      fail('VITE_API_URL', `invalid URL: ${viteApi}`)
    }
  }

  const distIndex = path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html')
  if (fs.existsSync(distIndex)) {
    ok('frontend/dist', 'present (rebuild after changing VITE_API_URL)')
  } else {
    warn('frontend/dist', 'missing — run npm run build after setting VITE_API_URL')
  }

  if (dbHost && dbUser && dbName) {
    try {
      const host = dbHost === 'localhost' ? '127.0.0.1' : dbHost
      const conn = await mysql.createConnection({
        host,
        user: dbUser,
        password: dbPassword,
        database: dbName,
      })
      await conn.execute('SELECT 1')
      const [rows] = await conn.execute(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'Admin' AND COALESCE(is_active, 1) = 1",
      )
      const adminCount = Number(rows[0]?.n || 0)
      if (adminCount < 1) {
        fail('Admin account', 'none found — run npm run seed:admin or npm run admin:reset')
      } else {
        ok('Database', `${host}/${dbName}, Admin accounts: ${adminCount}`)
      }
      await conn.end()
    } catch (error) {
      fail('Database connection', error.code || error.message)
    }
  }

  console.log('')
  if (errors.length) {
    console.log(`Blocked: ${errors.length} issue(s). Fix these before going online.`)
    process.exit(1)
  }
  if (warnings.length) {
    console.log(`Ready with ${warnings.length} warning(s). Review them before go-live.`)
    process.exit(0)
  }
  console.log('All production checks passed.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
