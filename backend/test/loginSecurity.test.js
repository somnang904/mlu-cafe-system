const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const express = require('express')
const bcrypt = require('bcrypt')

const { requireAdmin } = require('../src/middleware/auth')
const { getClientIp } = require('../src/utils/clientIp')
const { equalizeFailedLoginTiming, verifyPassword } = require('../src/utils/loginAuth')
const {
  INVALID_CREDENTIALS_MESSAGE,
  LOCKOUT_MESSAGE,
  LOCK_LADDER_MS,
  registerFailure,
  applyExpiry,
} = require('../src/utils/loginLockoutPolicy')
const {
  createMemorySecurityStore,
  processLoginAttempt,
  applyLoginResult,
  createBlockedDeviceMiddleware,
} = require('../src/utils/loginSecurity')
const { createSecurityAlertsRouter } = require('../src/routes/securityAlerts')

const PASSWORD = 'correct-horse'
const FINGERPRINT = 'ab'.repeat(32)

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function request(server, { method = 'GET', path = '/', body, headers = {} } = {}) {
  const payload = body == null ? null : JSON.stringify(body)
  const { port } = server.address()
  const started = Date.now()

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed = null
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {
            parsed = { raw: text }
          }
          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers,
            ms: Date.now() - started,
          })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function buildApp({ store, clock, findUser, onVerify, onDummy, lookupLocation, onSecurityAlert }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())
  app.use(createBlockedDeviceMiddleware(store))

  app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase()
    const password = req.body?.password == null ? '' : String(req.body.password)
    if (!username || !password) {
      return res.status(400).json({ message: 'Please provide both username and password' })
    }

    try {
      const result = await processLoginAttempt({
        username,
        password,
        ip: req.clientIp,
        fingerprint: req.deviceFingerprint,
        userAgent: req.get('user-agent') || '',
        acceptLanguage: req.get('accept-language') || '',
        now: clock.now,
        store,
        findUser,
        verifyPassword: async (plain, hash) => {
          onVerify?.()
          return verifyPassword(plain, hash)
        },
        equalizeFailedLoginTiming: async (plain) => {
          onDummy?.()
          return equalizeFailedLoginTiming(plain)
        },
        lookupLocation: lookupLocation || (async () => 'Unknown'),
        onSecurityAlert,
      })
      if (!result.ok) return applyLoginResult(res, result)
      return res.status(200).json({ message: 'Login successful', user: { username: result.user.username } })
    } catch {
      return res.status(500).json({ message: 'Internal server error occurred during login' })
    }
  })

  app.get('/api/orders', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.get('/api/menu', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  app.use(
    '/api/security-alerts',
    (req, _res, next) => {
      req.user = {
        id: 1,
        username: 'tester',
        role: req.get('x-test-role') || 'Staff',
      }
      next()
    },
    createSecurityAlertsRouter({ store, requireAdmin }),
  )

  return app
}

async function withApp(options, fn) {
  const app = buildApp(options)
  const server = await listen(app)
  try {
    return await fn(server)
  } finally {
    await close(server)
  }
}

test('wrong username and wrong password return identical responses', async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  let verifies = 0
  let dummies = 0

  await withApp(
    {
      store,
      clock,
      findUser: async (username) => (
        username === 'cashier'
          ? { id: 4, username: 'cashier', password_hash: passwordHash, role: 'Staff' }
          : null
      ),
      onVerify: () => {
        verifies += 1
      },
      onDummy: () => {
        dummies += 1
      },
    },
    async (server) => {
      const unknownUser = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'nobody', password: 'wrong-password' },
      })
      const wrongPassword = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'cashier', password: 'wrong-password' },
      })

      assert.equal(unknownUser.status, 401)
      assert.equal(wrongPassword.status, 401)
      assert.deepEqual(unknownUser.body, { message: INVALID_CREDENTIALS_MESSAGE })
      assert.deepEqual(wrongPassword.body, unknownUser.body)
      assert.equal(JSON.stringify(unknownUser.body).includes('stack'), false)
      assert.equal(dummies, 1)
      assert.equal(verifies, 1)
      assert.ok(unknownUser.ms > 25, `unknown user responded too quickly (${unknownUser.ms}ms)`)
      assert.ok(wrongPassword.ms > 25, `wrong password responded too quickly (${wrongPassword.ms}ms)`)
      const gap = Math.abs(unknownUser.ms - wrongPassword.ms)
      assert.ok(gap < 400, `response times diverged by ${gap}ms`)
    },
  )
})

test('the 4th failure locks the device for 30 seconds', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }

  await withApp(
    {
      store,
      clock,
      findUser: async () => null,
      onDummy: () => {},
    },
    async (server) => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const response = await request(server, {
          method: 'POST',
          path: '/api/auth/login',
          body: { username: 'cashier', password: 'wrong-password' },
        })
        assert.equal(response.status, 401, `attempt ${attempt} should still be a normal failure`)
      }

      const fourth = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'cashier', password: 'wrong-password' },
      })

      assert.equal(fourth.status, 429)
      assert.equal(fourth.body.message, LOCKOUT_MESSAGE)
      assert.equal(fourth.body.retryAfterSeconds, 30)
      assert.equal(fourth.headers['retry-after'], '30')
    },
  )
})

test('the lock raises a security alert with the device details', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  const alerts = []

  await withApp(
    {
      store,
      clock,
      findUser: async () => null,
      onDummy: () => {},
      lookupLocation: async () => 'Siem Reap, Cambodia',
      onSecurityAlert: (alert) => {
        alerts.push(alert)
      },
    },
    async (server) => {
      const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0', 'X-Device-Id': FINGERPRINT }
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await request(server, {
          method: 'POST',
          path: '/api/auth/login',
          body: { username: 'missing-user', password: 'wrong-password' },
          headers,
        })
      }
      assert.equal(store.alerts.length, 0, 'no alert before the lock')

      const fourth = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'missing-user', password: 'wrong-password' },
        headers: { ...headers, 'Accept-Language': 'en' },
      })

      assert.equal(fourth.status, 429)
      assert.equal(fourth.body.retryAfterSeconds, 30)
      assert.equal(store.alerts.length, 1)
      assert.equal(store.alerts[0].status, 'NEW')
      assert.equal(store.alerts[0].username, 'missing-user')
      assert.equal(store.alerts[0].failedAttempts, 4)
      assert.equal(store.alerts[0].location, 'Siem Reap, Cambodia')
      assert.equal(store.alerts[0].browser, 'Chrome')
      assert.equal(store.alerts[0].osName, 'Windows')
      assert.equal(store.alerts[0].deviceFingerprint, FINGERPRINT)
      assert.equal(alerts.length, 1)
      assert.equal(JSON.stringify(fourth.body).includes('stack'), false)
    },
  )
})

test('attempts during the lock are rejected and do not raise more alerts', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }

  await withApp(
    {
      store,
      clock,
      findUser: async () => null,
      onDummy: () => {},
    },
    async (server) => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await request(server, {
          method: 'POST',
          path: '/api/auth/login',
          body: { username: 'cashier', password: 'wrong-password' },
        })
      }
      clock.now += 10 * 1000

      const during = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'cashier', password: 'wrong-password' },
      })

      assert.equal(during.status, 429)
      assert.equal(during.body.retryAfterSeconds, 20)
      assert.equal(store.alerts.length, 1)
    },
  )
})

test('locked accounts reject even the correct password', async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  let verifies = 0

  await withApp(
    {
      store,
      clock,
      findUser: async (username) => (
        username === 'cashier'
          ? { id: 4, username: 'cashier', password_hash: passwordHash, role: 'Staff' }
          : null
      ),
      onVerify: () => {
        verifies += 1
      },
    },
    async (server) => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await request(server, {
          method: 'POST',
          path: '/api/auth/login',
          body: { username: 'cashier', password: 'wrong-password' },
        })
      }
      const checksAfterLock = verifies

      const correct = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'cashier', password: PASSWORD },
      })

      assert.equal(correct.status, 429)
      assert.equal(correct.body.message, LOCKOUT_MESSAGE)
      assert.equal(correct.body.token, undefined)
      assert.equal(verifies, checksAfterLock)
    },
  )
})

test('the failure counter restarts after a lock expires and the next lock is longer', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }

  await withApp(
    {
      store,
      clock,
      findUser: async () => null,
      onDummy: () => {},
    },
    async (server) => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await request(server, {
          method: 'POST',
          path: '/api/auth/login',
          body: { username: 'cashier', password: 'wrong-password' },
        })
      }

      clock.now += 30 * 1000 + 1

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const response = await request(server, {
          method: 'POST',
          path: '/api/auth/login',
          body: { username: 'cashier', password: 'wrong-password' },
        })
        assert.equal(response.status, 401, `post-expiry attempt ${attempt} should count from zero`)
      }

      const relock = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'cashier', password: 'wrong-password' },
      })
      assert.equal(relock.status, 429)
      assert.equal(relock.body.retryAfterSeconds, 120)
      assert.equal(store.alerts.length, 1, 'a repeat lock within 10 minutes does not raise another alert')
    },
  )
})

test('a blocked device gets 403 on any endpoint', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  await store.blockDevice({
    ip: '203.0.113.10',
    fingerprint: FINGERPRINT,
    alertId: 1,
    blockedBy: 1,
  })

  await withApp(
    {
      store,
      clock,
      findUser: async () => null,
    },
    async (server) => {
      const orders = await request(server, {
        method: 'GET',
        path: '/api/orders',
        headers: { 'X-Device-Id': FINGERPRINT },
      })
      const menu = await request(server, {
        method: 'GET',
        path: '/api/menu',
        headers: { 'X-Device-Id': FINGERPRINT },
      })
      const login = await request(server, {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'cashier', password: PASSWORD },
        headers: { 'X-Device-Id': FINGERPRINT },
      })
      const otherDevice = await request(server, {
        method: 'GET',
        path: '/api/menu',
        headers: { 'X-Device-Id': 'cd'.repeat(32) },
      })

      assert.equal(orders.status, 403)
      assert.equal(menu.status, 403)
      assert.equal(login.status, 403)
      assert.deepEqual(orders.body, { message: 'Access denied.' })
      assert.equal(otherDevice.status, 200)
    },
  )
})

test('non-admin users cannot access the alert endpoints', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  await store.insertAlert({
    username: 'cashier',
    ipAddress: '203.0.113.10',
    userAgent: 'test',
    browser: 'Chrome',
    osName: 'Windows',
    deviceType: 'Desktop',
    deviceFingerprint: FINGERPRINT,
    location: 'Unknown',
    failedAttempts: 4,
    stage: 1,
    createdAt: new Date(clock.now).toISOString(),
  })

  await withApp(
    {
      store,
      clock,
      findUser: async () => null,
    },
    async (server) => {
      const staffList = await request(server, {
        method: 'GET',
        path: '/api/security-alerts',
        headers: { 'X-Test-Role': 'Staff' },
      })
      const staffBlock = await request(server, {
        method: 'POST',
        path: '/api/security-alerts/1/block',
        headers: { 'X-Test-Role': 'Staff' },
      })
      const adminList = await request(server, {
        method: 'GET',
        path: '/api/security-alerts',
        headers: { 'X-Test-Role': 'Admin' },
      })

      assert.equal(staffList.status, 403)
      assert.equal(staffList.body.message, 'Administrator access required')
      assert.equal(staffBlock.status, 403)
      assert.equal(adminList.status, 200)
      assert.equal(adminList.body.alerts.length, 1)
      assert.equal(JSON.stringify(staffList.body).includes('stack'), false)
    },
  )
})

test('X-Forwarded-For is ignored unless the app is behind a trusted proxy', () => {
  const req = {
    ip: '203.0.113.77',
    headers: { 'x-forwarded-for': '203.0.113.77' },
    socket: { remoteAddress: '::ffff:127.0.0.1' },
  }

  assert.equal(getClientIp(req, { trustProxy: false }), '127.0.0.1')
  assert.equal(getClientIp(req, { trustProxy: true }), '203.0.113.77')
})

function directAttempt(store, clock, { username, ip, password = 'wrong-password', user = null, onAlert }) {
  return processLoginAttempt({
    username,
    password,
    ip,
    fingerprint: FINGERPRINT,
    userAgent: 'test',
    acceptLanguage: 'en',
    now: clock.now,
    store,
    findUser: async () => user,
    verifyPassword,
    equalizeFailedLoginTiming: async () => {},
    lookupLocation: async () => 'Unknown',
    onSecurityAlert: onAlert,
  })
}

test('lock time escalates 30s, 2min, 10min, 30min and stays capped', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  const seen = []

  for (let round = 0; round < 6; round += 1) {
    let last
    for (let i = 0; i < 4; i += 1) {
      last = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
    }
    assert.equal(last.status, 429)
    seen.push(last.retryAfterSeconds)
    clock.now += last.retryAfterSeconds * 1000 + 1
  }

  assert.deepEqual(seen, [30, 120, 600, 1800, 1800, 1800])
  assert.deepEqual(LOCK_LADDER_MS.map((ms) => ms / 1000), [30, 120, 600, 1800])
})

test('the lock level resets after a clean hour and after a successful login', async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4)
  const user = { id: 1, username: 'owner', password_hash: passwordHash, role: 'Admin' }
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }

  for (let i = 0; i < 4; i += 1) await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  clock.now += 31 * 1000
  let second
  for (let i = 0; i < 4; i += 1) second = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  assert.equal(second.retryAfterSeconds, 120)

  clock.now += 63 * 60 * 1000
  let afterHour
  for (let i = 0; i < 4; i += 1) afterHour = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  assert.equal(afterHour.retryAfterSeconds, 30)

  clock.now += 31 * 1000
  const ok = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5', password: PASSWORD, user })
  assert.equal(ok.ok, true)
  let afterSuccess
  for (let i = 0; i < 4; i += 1) afterSuccess = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  assert.equal(afterSuccess.retryAfterSeconds, 30)
})

test('an attacker IP cannot lock the owner out on another IP', async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4)
  const user = { id: 1, username: 'owner', password_hash: passwordHash, role: 'Admin' }
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }

  let attacker
  for (let i = 0; i < 4; i += 1) attacker = await directAttempt(store, clock, { username: 'owner', ip: '198.51.100.9' })
  assert.equal(attacker.status, 429)

  const attackerAgain = await directAttempt(store, clock, { username: 'owner', ip: '198.51.100.9', password: PASSWORD, user })
  assert.equal(attackerAgain.status, 429)

  const owner = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5', password: PASSWORD, user })
  assert.equal(owner.ok, true)
})

test('20 failures across many devices lock the username for 15 minutes with one alert', async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 4)
  const user = { id: 1, username: 'owner', password_hash: passwordHash, role: 'Admin' }
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }
  let alertsSent = 0
  const onAlert = () => {
    alertsSent += 1
  }

  let last
  for (let i = 0; i < 19; i += 1) {
    last = await directAttempt(store, clock, { username: 'owner', ip: `198.51.100.${i + 1}`, onAlert })
    assert.equal(last.status, 401)
  }
  last = await directAttempt(store, clock, { username: 'owner', ip: '198.51.100.99', onAlert })
  assert.equal(last.status, 429)
  assert.equal(last.retryAfterSeconds, 900)

  const owner = await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5', password: PASSWORD, user })
  assert.equal(owner.status, 429)
  assert.equal(store.alerts.length, 1)
  assert.equal(alertsSent, 1)
})

test('failures older than the 15 minute window do not accumulate', () => {
  const start = Date.parse('2026-09-29T00:00:00Z')
  let attempt = null
  for (let i = 0; i < 3; i += 1) attempt = registerFailure(attempt, start, 'user').attempt
  const later = start + 16 * 60 * 1000
  assert.equal(applyExpiry(attempt, later).failedCount, 0)
  const next = registerFailure(attempt, later, 'device')
  assert.equal(next.triggeredLock, false)
  assert.equal(next.attempt.failedCount, 1)
})

test('at most one security alert per username every 10 minutes', async () => {
  const store = createMemorySecurityStore()
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') }

  for (let i = 0; i < 4; i += 1) await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  clock.now += 31 * 1000
  for (let i = 0; i < 4; i += 1) await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  assert.equal(store.alerts.length, 1)

  clock.now += 11 * 60 * 1000
  for (let i = 0; i < 4; i += 1) await directAttempt(store, clock, { username: 'owner', ip: '203.0.113.5' })
  assert.equal(store.alerts.length, 2)

  for (let i = 0; i < 4; i += 1) await directAttempt(store, clock, { username: 'other', ip: '203.0.113.6' })
  assert.equal(store.alerts.length, 3)
})
