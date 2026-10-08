const db = require('../../db')
const { logError, logSecurity } = require('./logger')
const { getClientIp } = require('./clientIp')
const { resolveRequestFingerprint, parseUserAgent } = require('./deviceFingerprint')
const { lookupIpLocation } = require('./ipLocation')
const {
  INVALID_CREDENTIALS_MESSAGE,
  LOCKOUT_MESSAGE,
  applyExpiry,
  lockRemainingSeconds,
  isLocked,
  registerFailure,
  ALERT_COOLDOWN_MS,
  LEVEL_RESET_MS,
  SCOPE_DEVICE,
  SCOPE_IP,
  SCOPE_USER,
} = require('./loginLockoutPolicy')

const USER_WIDE_IP = '*'
const IP_WIDE_USER = '*'

const { registerSchemaReset } = require('./schemaReset')
let schemaReadyPromise = null
registerSchemaReset(() => {
  schemaReadyPromise = null
})

async function ensureLoginSecuritySchema(database = db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await database.execute(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(191) NOT NULL,
          ip_address VARCHAR(45) NOT NULL,
          device_fingerprint CHAR(64) NULL,
          failed_count INT NOT NULL DEFAULT 0,
          stage TINYINT NOT NULL DEFAULT 1,
          locked_until DATETIME NULL,
          last_attempt_at DATETIME NOT NULL,
          window_started_at DATETIME NULL,
          UNIQUE KEY uq_login_attempts_user_ip (username, ip_address),
          KEY idx_login_attempts_locked (locked_until),
          KEY idx_login_attempts_ip (ip_address)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      const [windowColumn] = await database.execute(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_attempts'
           AND COLUMN_NAME = 'window_started_at' LIMIT 1`,
      )
      if (!windowColumn.length) {
        await database.execute('ALTER TABLE login_attempts ADD COLUMN window_started_at DATETIME NULL')
      }
      await database.execute(`
        CREATE TABLE IF NOT EXISTS security_alerts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(191) NOT NULL,
          ip_address VARCHAR(45) NOT NULL,
          user_agent VARCHAR(512) NULL,
          browser VARCHAR(64) NULL,
          os_name VARCHAR(64) NULL,
          device_type VARCHAR(32) NULL,
          device_fingerprint CHAR(64) NULL,
          location VARCHAR(191) NOT NULL DEFAULT 'Unknown',
          failed_attempts INT NOT NULL,
          stage TINYINT NOT NULL,
          status ENUM('NEW', 'REVIEWED', 'BLOCKED') NOT NULL DEFAULT 'NEW',
          created_at DATETIME NOT NULL,
          reviewed_at DATETIME NULL,
          KEY idx_security_alerts_status (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      await database.execute(`
        CREATE TABLE IF NOT EXISTS blocked_devices (
          id INT AUTO_INCREMENT PRIMARY KEY,
          ip_address VARCHAR(45) NOT NULL,
          device_fingerprint CHAR(64) NOT NULL,
          alert_id INT NULL,
          blocked_by INT NULL,
          created_at DATETIME NOT NULL,
          UNIQUE KEY uq_blocked_device (ip_address, device_fingerprint),
          KEY idx_blocked_devices_ip (ip_address),
          KEY idx_blocked_devices_fp (device_fingerprint)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

function attemptScopes(username, ip) {
  return [
    { username, ip: USER_WIDE_IP, kind: SCOPE_USER },
    { username: IP_WIDE_USER, ip, kind: SCOPE_IP },
    { username, ip, kind: SCOPE_DEVICE },
  ]
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function mapAttemptRow(row) {
  if (!row) return null
  const locked = toDate(row.locked_until)
  const windowStarted = toDate(row.window_started_at)
  return {
    username: row.username,
    ip: row.ip_address,
    fingerprint: row.device_fingerprint || null,
    failedCount: Number(row.failed_count) || 0,
    stage: Number(row.stage) || 1,
    lockedUntil: locked ? locked.getTime() : null,
    windowStartedAt: windowStarted ? windowStarted.getTime() : null,
  }
}

function mapAlertRow(row) {
  return {
    id: row.id,
    username: row.username,
    ipAddress: row.ip_address,
    userAgent: row.user_agent || '',
    browser: row.browser || 'Unknown',
    osName: row.os_name || 'Unknown',
    deviceType: row.device_type || 'Unknown',
    deviceFingerprint: row.device_fingerprint || '',
    location: row.location || 'Unknown',
    failedAttempts: Number(row.failed_attempts) || 0,
    stage: Number(row.stage) || 1,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }
}

function createMysqlSecurityStore(database = db) {
  return {
    async getAttempt(username, ip) {
      await ensureLoginSecuritySchema(database)
      const [rows] = await database.execute(
        `SELECT username, ip_address, device_fingerprint, failed_count, stage, locked_until,
                window_started_at
         FROM login_attempts WHERE username = ? AND ip_address = ? LIMIT 1`,
        [username, ip],
      )
      return mapAttemptRow(rows[0])
    },

    async saveAttempt({
      username,
      ip,
      fingerprint,
      failedCount,
      stage,
      lockedUntil,
      lastAttemptAt,
      windowStartedAt,
    }) {
      await ensureLoginSecuritySchema(database)
      await database.execute(
        `INSERT INTO login_attempts
           (username, ip_address, device_fingerprint, failed_count, stage, locked_until,
            last_attempt_at, window_started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           device_fingerprint = VALUES(device_fingerprint),
           failed_count = VALUES(failed_count),
           stage = VALUES(stage),
           locked_until = VALUES(locked_until),
           last_attempt_at = VALUES(last_attempt_at),
           window_started_at = VALUES(window_started_at)`,
        [
          username,
          ip,
          fingerprint || null,
          failedCount,
          stage,
          lockedUntil ? new Date(lockedUntil) : null,
          new Date(lastAttemptAt),
          windowStartedAt ? new Date(windowStartedAt) : null,
        ],
      )
    },

    async clearAttempts(username, ip) {
      await ensureLoginSecuritySchema(database)
      await database.execute(
        `DELETE FROM login_attempts
         WHERE username = ?
            OR (username = ? AND ip_address = ?)`,
        [username, IP_WIDE_USER, ip],
      )
    },

    async insertAlert(alert) {
      await ensureLoginSecuritySchema(database)
      const createdAt = new Date(alert.createdAt)
      const [result] = await database.execute(
        `INSERT INTO security_alerts
           (username, ip_address, user_agent, browser, os_name, device_type, device_fingerprint,
            location, failed_attempts, stage, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?)`,
        [
          alert.username,
          alert.ipAddress,
          alert.userAgent || null,
          alert.browser || 'Unknown',
          alert.osName || 'Unknown',
          alert.deviceType || 'Unknown',
          alert.deviceFingerprint || null,
          alert.location || 'Unknown',
          alert.failedAttempts,
          alert.stage,
          createdAt,
        ],
      )
      return { ...alert, id: result.insertId, status: 'NEW', createdAt }
    },

    async hasRecentAlert(username, sinceMs) {
      await ensureLoginSecuritySchema(database)
      const [rows] = await database.execute(
        'SELECT id FROM security_alerts WHERE username = ? AND created_at >= ? LIMIT 1',
        [username, new Date(sinceMs)],
      )
      return rows.length > 0
    },

    async listAlerts({ status } = {}) {
      await ensureLoginSecuritySchema(database)
      const filter = status && status !== 'ALL' ? status : null
      const [rows] = await database.execute(
        `SELECT id, username, ip_address, user_agent, browser, os_name, device_type,
                device_fingerprint, location, failed_attempts, stage, status, created_at, reviewed_at
         FROM security_alerts
         WHERE (? IS NULL OR status = ?)
         ORDER BY created_at DESC
         LIMIT 200`,
        [filter, filter],
      )
      return rows.map(mapAlertRow)
    },

    async getAlert(id) {
      await ensureLoginSecuritySchema(database)
      const [rows] = await database.execute(
        `SELECT id, username, ip_address, user_agent, browser, os_name, device_type,
                device_fingerprint, location, failed_attempts, stage, status, created_at, reviewed_at
         FROM security_alerts WHERE id = ? LIMIT 1`,
        [id],
      )
      return rows[0] ? mapAlertRow(rows[0]) : null
    },

    async updateAlertStatus(id, status) {
      await ensureLoginSecuritySchema(database)
      await database.execute(
        `UPDATE security_alerts
         SET status = ?, reviewed_at = IF(? = 'REVIEWED', ?, reviewed_at)
         WHERE id = ?`,
        [status, status, new Date(), id],
      )
      return this.getAlert(id)
    },

    async blockDevice({ ip, fingerprint, alertId, blockedBy }) {
      await ensureLoginSecuritySchema(database)
      await database.execute(
        `INSERT INTO blocked_devices (ip_address, device_fingerprint, alert_id, blocked_by, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE alert_id = VALUES(alert_id), blocked_by = VALUES(blocked_by)`,
        [ip, fingerprint, alertId || null, blockedBy || null, new Date()],
      )
    },

    async unblockDevice({ ip, fingerprint }) {
      await ensureLoginSecuritySchema(database)
      await database.execute(
        `DELETE FROM blocked_devices WHERE ip_address = ? AND device_fingerprint = ?`,
        [ip, fingerprint],
      )
    },

    async isBlocked({ ip, fingerprint }) {
      await ensureLoginSecuritySchema(database)
      const [rows] = await database.execute(
        `SELECT id FROM blocked_devices
         WHERE ip_address = ?
            OR (? <> '' AND device_fingerprint = ?)
         LIMIT 1`,
        [ip, fingerprint || '', fingerprint || ''],
      )
      return rows.length > 0
    },

    async cleanupExpired(nowMs) {
      await ensureLoginSecuritySchema(database)
      const [result] = await database.execute(
        `DELETE FROM login_attempts
         WHERE (locked_until IS NOT NULL AND locked_until < ?)
            OR (locked_until IS NULL AND last_attempt_at < ?)`,
        [new Date(nowMs - LEVEL_RESET_MS), new Date(nowMs - LEVEL_RESET_MS)],
      )
      return result.affectedRows || 0
    },
  }
}

function createMemorySecurityStore() {
  const attempts = new Map()
  const alerts = []
  const blocks = []
  let nextAlertId = 1

  const keyOf = (username, ip) => `${username}\0${ip}`

  return {
    attempts,
    alerts,
    blocks,

    async getAttempt(username, ip) {
      return attempts.get(keyOf(username, ip)) || null
    },

    async saveAttempt(record) {
      attempts.set(keyOf(record.username, record.ip), {
        username: record.username,
        ip: record.ip,
        fingerprint: record.fingerprint || null,
        failedCount: record.failedCount,
        stage: record.stage,
        lockedUntil: record.lockedUntil,
        windowStartedAt: record.windowStartedAt ?? null,
        lastAttemptAt: record.lastAttemptAt ?? null,
      })
    },

    async clearAttempts(username, ip) {
      for (const key of [...attempts.keys()]) {
        const row = attempts.get(key)
        if (row.username === username || (row.username === IP_WIDE_USER && row.ip === ip)) {
          attempts.delete(key)
        }
      }
    },

    async insertAlert(alert) {
      const row = { ...alert, id: nextAlertId, status: 'NEW' }
      nextAlertId += 1
      alerts.push(row)
      return row
    },

    async hasRecentAlert(username, sinceMs) {
      return alerts.some(
        (row) => row.username === username && new Date(row.createdAt).getTime() >= sinceMs,
      )
    },

    async listAlerts({ status } = {}) {
      const rows = status && status !== 'ALL' ? alerts.filter((row) => row.status === status) : alerts
      return [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    },

    async getAlert(id) {
      return alerts.find((row) => row.id === Number(id)) || null
    },

    async updateAlertStatus(id, status) {
      const row = alerts.find((item) => item.id === Number(id))
      if (!row) return null
      row.status = status
      if (status === 'REVIEWED') row.reviewedAt = new Date()
      return row
    },

    async blockDevice({ ip, fingerprint, alertId, blockedBy }) {
      const existing = blocks.find((row) => row.ip === ip && row.fingerprint === fingerprint)
      if (existing) {
        existing.alertId = alertId || existing.alertId
        existing.blockedBy = blockedBy || existing.blockedBy
        return
      }
      blocks.push({ ip, fingerprint, alertId: alertId || null, blockedBy: blockedBy || null })
    },

    async unblockDevice({ ip, fingerprint }) {
      const index = blocks.findIndex((row) => row.ip === ip && row.fingerprint === fingerprint)
      if (index >= 0) blocks.splice(index, 1)
    },

    async isBlocked({ ip, fingerprint }) {
      return blocks.some(
        (row) => row.ip === ip || (fingerprint && row.fingerprint === fingerprint),
      )
    },

    async cleanupExpired(nowMs) {
      let removed = 0
      for (const [key, row] of attempts) {
        const stale = row.lockedUntil
          ? row.lockedUntil < nowMs - LEVEL_RESET_MS
          : (row.lastAttemptAt ?? nowMs) < nowMs - LEVEL_RESET_MS
        if (stale) {
          attempts.delete(key)
          removed += 1
        }
      }
      return removed
    },
  }
}

function invalidResult() {
  return {
    ok: false,
    status: 401,
    retryAfterSeconds: 0,
    body: { message: INVALID_CREDENTIALS_MESSAGE },
  }
}

function lockedResult(retryAfterSeconds) {
  const seconds = Math.max(1, Number(retryAfterSeconds) || 1)
  return {
    ok: false,
    status: 429,
    retryAfterSeconds: seconds,
    body: {
      message: LOCKOUT_MESSAGE,
      retryAfterSeconds: seconds,
    },
  }
}

function applyLoginResult(res, result) {
  if (result.retryAfterSeconds) {
    res.set('Retry-After', String(result.retryAfterSeconds))
  }
  return res.status(result.status).json(result.body)
}

async function loadScopes(store, username, ip) {
  const scopes = attemptScopes(username, ip)
  const rows = []
  for (const scope of scopes) {
    rows.push({
      scope,
      attempt: await store.getAttempt(scope.username, scope.ip),
    })
  }
  return rows
}

async function processLoginAttempt({
  username,
  password,
  ip,
  fingerprint,
  userAgent,
  acceptLanguage,
  now = Date.now(),
  store,
  findUser,
  verifyPassword,
  equalizeFailedLoginTiming,
  lookupLocation = lookupIpLocation,
  onSecurityAlert,
}) {
  const loaded = await loadScopes(store, username, ip)
  const active = loaded.map((entry) => ({
    scope: entry.scope,
    attempt: applyExpiry(entry.attempt, now),
  }))

  const lockedSeconds = active.map((entry) => lockRemainingSeconds(entry.attempt, now))
  const retryAfterSeconds = Math.max(0, ...lockedSeconds)
  if (retryAfterSeconds > 0) {
    logSecurity('login_locked', {
      ip,
      username: String(username).slice(0, 64),
      retryAfterSeconds,
    })
    return lockedResult(retryAfterSeconds)
  }

  const user = await findUser(username)
  const storedHash = user?.password_hash || user?.password || null
  let passwordMatches = false

  try {
    if (user && storedHash) {
      passwordMatches = await verifyPassword(password, storedHash)
    } else {
      await equalizeFailedLoginTiming(password)
    }
  } catch (error) {
    logError(error, { route: 'POST /api/auth/login', stage: 'password-compare' })
    passwordMatches = false
  }

  if (user && storedHash && passwordMatches) {
    const stillLocked = active.some((entry) => isLocked(entry.attempt, now))
    if (!stillLocked) {
      await store.clearAttempts(username, ip)
    }
    return { ok: true, status: 200, user }
  }

  logSecurity('login_failed', {
    ip,
    username: String(username).slice(0, 64),
  })

  const recorded = []
  for (const entry of active) {
    const next = registerFailure(entry.attempt, now, entry.scope.kind)
    await store.saveAttempt({
      username: entry.scope.username,
      ip: entry.scope.ip,
      fingerprint,
      failedCount: next.attempt.failedCount,
      stage: next.attempt.stage,
      lockedUntil: next.attempt.lockedUntil,
      lastAttemptAt: now,
      windowStartedAt: next.attempt.windowStartedAt,
    })
    recorded.push(next)
  }

  const alertDue =
    recorded.some((entry) => entry.triggeredAlert) &&
    !(await store.hasRecentAlert(username, now - ALERT_COOLDOWN_MS))

  if (alertDue) {
    const agent = parseUserAgent(userAgent)
    let location = 'Unknown'
    try {
      location = (await lookupLocation(ip)) || 'Unknown'
    } catch {
      location = 'Unknown'
    }

    const failedAttempts = Math.max(...recorded.map((entry) => entry.attempt.failedCount))
    const alert = await store.insertAlert({
      username,
      ipAddress: ip,
      userAgent: agent.userAgent,
      browser: agent.browser,
      osName: agent.osName,
      deviceType: agent.deviceType,
      acceptLanguage: String(acceptLanguage || '').slice(0, 128),
      deviceFingerprint: fingerprint,
      location,
      failedAttempts,
      stage: 1,
      createdAt: new Date(now).toISOString(),
    })

    logSecurity('login_lockout_alert', {
      ip,
      username: String(username).slice(0, 64),
      failedAttempts,
      stage: 1,
      location,
    })

    if (onSecurityAlert) {
      Promise.resolve(onSecurityAlert(alert)).catch((error) => {
        logError(error, { route: 'security-alert-notify' })
      })
    }
  }

  if (recorded.some((entry) => entry.triggeredLock || entry.alreadyLocked)) {
    const seconds = Math.max(
      ...recorded.map((entry) => lockRemainingSeconds(entry.attempt, now)),
    )
    return lockedResult(seconds)
  }

  return invalidResult()
}

function createBlockedDeviceMiddleware(store) {
  return async function blockedDeviceMiddleware(req, res, next) {
    try {
      const ip = getClientIp(req)
      const fingerprint = resolveRequestFingerprint(req)
      req.clientIp = ip
      req.deviceFingerprint = fingerprint
      const blocked = await store.isBlocked({ ip, fingerprint })
      if (blocked) {
        logSecurity('device_blocked', { ip, fingerprint })
        return res.status(403).json({ message: 'Access denied.' })
      }
    } catch (error) {
      logError(error, { route: 'blocked-device' })
    }
    return next()
  }
}

function toFeedAlert(alert) {
  const when = alert.createdAt ? new Date(alert.createdAt).toISOString() : new Date().toISOString()
  return {
    id: `security-alert-${alert.id}`,
    category: 'security_alert',
    severity: 'critical',
    title: 'Login lockout',
    message: `${alert.username} was locked after ${alert.failedAttempts} failed attempts from ${alert.ipAddress} (${alert.location || 'Unknown'}).`,
    timestamp: when,
    action: {
      label: 'Security Alerts',
      navigateTo: 'security_alerts',
    },
    meta: {
      alertId: alert.id,
      status: alert.status,
      username: alert.username,
      ipAddress: alert.ipAddress,
      location: alert.location,
    },
  }
}

async function listNewSecurityAlertFeed(database = db) {
  const store = createMysqlSecurityStore(database)
  const rows = await store.listAlerts({ status: 'NEW' })
  return rows.map(toFeedAlert)
}

let cleanupTimer = null

function startLoginSecurityCleanup(database = db) {
  if (cleanupTimer) return cleanupTimer
  const store = createMysqlSecurityStore(database)
  const run = () => {
    store.cleanupExpired(Date.now()).catch((error) => {
      logError(error, { route: 'login-security-cleanup' })
    })
  }
  run()
  cleanupTimer = setInterval(run, 60 * 60 * 1000)
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref()
  return cleanupTimer
}

module.exports = {
  USER_WIDE_IP,
  IP_WIDE_USER,
  ensureLoginSecuritySchema,
  createMysqlSecurityStore,
  createMemorySecurityStore,
  processLoginAttempt,
  applyLoginResult,
  createBlockedDeviceMiddleware,
  listNewSecurityAlertFeed,
  startLoginSecurityCleanup,
  toFeedAlert,
}
