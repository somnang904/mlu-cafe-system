/**
 * HTTP smoke for persistent sessions.
 * Creates disposable Staff user, verifies gates, deletes afterwards.
 * Run: node test/sessionHttpSmoke.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const http = require('http')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../db')
const { env } = require('../src/config/env')
const { signSessionToken, ensureSessionSecuritySchema } = require('../src/utils/sessionSecurity')
const { createUserSession, ensureUserSessionsSchema } = require('../src/utils/userSessions')

const reports = []

function note(ok, label, detail = '') {
  reports.push({ ok, label, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: env.port || 5500,
        path: `/api${path}`,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Device-Id': 'a'.repeat(64),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try { json = JSON.parse(text) } catch { /* ignore */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function main() {
  await ensureSessionSecuritySchema(db)
  await ensureUserSessionsSchema(db)

  const [admins] = await db.execute(
    `SELECT id, username, role, display_name, permissions FROM users WHERE LOWER(role)='admin' ORDER BY id LIMIT 1`,
  )
  if (!admins.length) throw new Error('No admin')
  const admin = admins[0]

  const adminIssued = await signSessionToken(db, admin)
  await createUserSession(db, {
    jti: adminIssued.jti,
    userId: admin.id,
    req: { headers: { 'user-agent': 'SmokeAdmin/1.0' }, get: () => 'SmokeAdmin/1.0', ip: '127.0.0.1' },
  })

  // Old settings endpoints gone
  const missingHours = await request('PUT', '/settings/session-hours', { token: adminIssued.token, body: { hours: 8 } })
  note(missingHours.status === 404, 'PUT /settings/session-hours removed', `status=${missingHours.status}`)
  const missingIdle = await request('PUT', '/settings/idle-timeout', { token: adminIssued.token, body: { minutes: 30 } })
  note(missingIdle.status === 404, 'PUT /settings/idle-timeout removed', `status=${missingIdle.status}`)
  const missingGet = await request('GET', '/settings', { token: adminIssued.token })
  note(missingGet.status === 404, 'GET /settings removed', `status=${missingGet.status}`)

  // Admin can list sessions
  const listed = await request('GET', '/security/sessions', { token: adminIssued.token })
  note(listed.status === 200 && Array.isArray(listed.json?.sessions), 'Admin lists sessions', `status=${listed.status}`)

  // Create disposable Staff
  const username = `sess_staff_${Date.now()}`
  const hash = await bcrypt.hash('TempPass1!Aa', 10)
  const [ins] = await db.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, must_change_password, is_active)
     VALUES (?, ?, ?, 'Staff', ?, 0, 1)`,
    ['Session Test Staff', username, hash, JSON.stringify(['order', 'table'])],
  )
  const staffId = ins.insertId
  const staff = { id: staffId, username, role: 'Staff', display_name: 'Session Test Staff', permissions: ['order', 'table'] }
  const staffIssued = await signSessionToken(db, staff)
  await createUserSession(db, {
    jti: staffIssued.jti,
    userId: staffId,
    req: { headers: { 'user-agent': 'SmokeStaff/1.0' }, get: () => 'SmokeStaff/1.0', ip: '127.0.0.1' },
  })

  const staffList = await request('GET', '/security/sessions', { token: staffIssued.token })
  note(staffList.status === 403, 'Staff cannot list sessions', `status=${staffList.status}`)
  const staffTerm = await request('POST', `/security/sessions/${staffIssued.jti}/terminate`, { token: staffIssued.token })
  note(staffTerm.status === 403, 'Staff cannot terminate sessions', `status=${staffTerm.status}`)

  // Second admin session then terminate one
  const admin2 = await signSessionToken(db, admin)
  await createUserSession(db, {
    jti: admin2.jti,
    userId: admin.id,
    req: { headers: { 'user-agent': 'SmokeAdmin2/1.0' }, get: () => 'SmokeAdmin2/1.0', ip: '127.0.0.1' },
  })
  const term = await request('POST', `/security/sessions/${admin2.jti}/terminate`, { token: adminIssued.token })
  note(term.status === 200, 'Admin terminates other session', `status=${term.status}`)
  const dead = await request('GET', '/auth/me', { token: admin2.token })
  note(
    dead.status === 401 && /administrator/i.test(dead.json?.message || ''),
    'Terminated session gets admin-ended 401',
    `status=${dead.status} msg=${dead.json?.message}`,
  )
  const alive = await request('GET', '/auth/me', { token: adminIssued.token })
  note(alive.status === 200, 'Other admin session still works', `status=${alive.status}`)

  // Sliding renew: token with iat older than 24h, same jti
  const agedToken = jwt.sign(
    {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      jti: adminIssued.jti,
      iat: Math.floor(Date.now() / 1000) - (25 * 60 * 60),
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
    },
    env.jwtSecret,
    { algorithm: 'HS256' },
  )
  const renewed = await request('GET', '/auth/me', { token: agedToken })
  const renewedHeader = renewed.headers['x-renewed-token']
  note(renewed.status === 200 && Boolean(renewedHeader), 'Token older than 24h renews via header', `status=${renewed.status} header=${Boolean(renewedHeader)}`)

  // Password change style revoke
  const { invalidateUserTokens } = require('../src/utils/sessionSecurity')
  await invalidateUserTokens(db, staffId, admin.id)
  const afterPw = await request('GET', '/auth/me', { token: staffIssued.token })
  note(afterPw.status === 401, 'invalidateUserTokens revokes staff sessions', `status=${afterPw.status}`)

  // Cleanup staff
  await db.execute('DELETE FROM user_sessions WHERE user_id = ?', [staffId])
  await db.execute('DELETE FROM revoked_tokens WHERE user_id = ?', [staffId])
  await db.execute('DELETE FROM users WHERE id = ?', [staffId])
  // Leave admin sessions; revoke the smoke ones we created except don't kill unknown live ones by jti only
  await db.execute('DELETE FROM user_sessions WHERE jti IN (?, ?)', [adminIssued.jti, admin2.jti])
  await db.execute('DELETE FROM revoked_tokens WHERE jti IN (?, ?)', [adminIssued.jti, admin2.jti])

  const failed = reports.filter((r) => !r.ok)
  console.log(`\n${reports.length - failed.length}/${reports.length} checks passed`)
  await db.end()
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (error) => {
  console.error(error)
  try { await db.end() } catch { /* ignore */ }
  process.exit(1)
})
