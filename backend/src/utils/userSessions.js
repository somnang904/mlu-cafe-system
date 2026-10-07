const { parseUserAgent } = require('./deviceFingerprint')
const { getClientIp } = require('./clientIp')

const SESSION_RETENTION_DAYS = 90
const LAST_SEEN_MIN_INTERVAL_MS = 60 * 1000

const { registerSchemaReset } = require('./schemaReset')
let schemaReady = null
registerSchemaReset(() => {
  schemaReady = null
})

async function ensureUserSessionsSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          jti VARCHAR(64) NOT NULL PRIMARY KEY,
          user_id INT NOT NULL,
          device_label VARCHAR(255) NULL,
          ip VARCHAR(64) NULL,
          user_agent VARCHAR(512) NULL,
          created_at DATETIME NOT NULL,
          last_seen_at DATETIME NOT NULL,
          revoked_at DATETIME NULL,
          revoked_by INT NULL,
          KEY idx_user_sessions_user (user_id),
          KEY idx_user_sessions_last_seen (last_seen_at),
          KEY idx_user_sessions_revoked (revoked_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

function buildDeviceLabel(userAgent) {
  const parsed = parseUserAgent(userAgent)
  return [parsed.browser, parsed.osName, parsed.deviceType].filter(Boolean).join(' · ').slice(0, 255)
}

function sessionMetaFromRequest(req) {
  const userAgent = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '').slice(0, 512)
  const ip = String(req.clientIp || getClientIp(req) || req.ip || '').slice(0, 64)
  return {
    deviceLabel: buildDeviceLabel(userAgent) || 'Unknown device',
    ip: ip || null,
    userAgent: userAgent || null,
  }
}

async function createUserSession(db, { jti, userId, req }) {
  await ensureUserSessionsSchema(db)
  const meta = sessionMetaFromRequest(req || {})
  const now = new Date()
  await db.execute(
    `INSERT INTO user_sessions
      (jti, user_id, device_label, ip, user_agent, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      String(jti).slice(0, 64),
      userId,
      meta.deviceLabel,
      meta.ip,
      meta.userAgent,
      now,
      now,
    ],
  )
  return meta
}

async function getSessionByJti(db, jti) {
  if (!jti) return null
  await ensureUserSessionsSchema(db)
  const [rows] = await db.execute(
    `SELECT jti, user_id, device_label, ip, user_agent, created_at, last_seen_at, revoked_at, revoked_by
     FROM user_sessions WHERE jti = ? LIMIT 1`,
    [String(jti).slice(0, 64)],
  )
  return rows[0] || null
}

async function touchUserSession(db, jti) {
  if (!jti) return
  await ensureUserSessionsSchema(db)
  const [rows] = await db.execute(
    'SELECT last_seen_at FROM user_sessions WHERE jti = ? AND revoked_at IS NULL LIMIT 1',
    [String(jti).slice(0, 64)],
  )
  if (!rows.length) return
  const lastSeen = new Date(rows[0].last_seen_at).getTime()
  if (Number.isFinite(lastSeen) && Date.now() - lastSeen < LAST_SEEN_MIN_INTERVAL_MS) return
  await db.execute(
    'UPDATE user_sessions SET last_seen_at = NOW() WHERE jti = ? AND revoked_at IS NULL',
    [String(jti).slice(0, 64)],
  )
}

async function revokeUserSession(db, jti, revokedBy = null) {
  if (!jti) return false
  await ensureUserSessionsSchema(db)
  const [result] = await db.execute(
    `UPDATE user_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()), revoked_by = COALESCE(revoked_by, ?)
     WHERE jti = ?`,
    [revokedBy, String(jti).slice(0, 64)],
  )
  return Number(result.affectedRows || 0) > 0
}

async function revokeAllUserSessions(db, userId, revokedBy = null) {
  await ensureUserSessionsSchema(db)
  const [result] = await db.execute(
    `UPDATE user_sessions
     SET revoked_at = NOW(), revoked_by = ?
     WHERE user_id = ? AND revoked_at IS NULL`,
    [revokedBy, userId],
  )
  return Number(result.affectedRows || 0)
}

async function listUserSessions(db, { includeRevoked = true, limit = 200 } = {}) {
  await ensureUserSessionsSchema(db)
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500)
  const where = includeRevoked
    ? 'WHERE s.revoked_at IS NULL OR s.revoked_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
    : 'WHERE s.revoked_at IS NULL'
  const [rows] = await db.execute(
    `SELECT s.jti, s.user_id, s.device_label, s.ip, s.user_agent,
            s.created_at, s.last_seen_at, s.revoked_at, s.revoked_by,
            u.username, u.display_name, u.role
     FROM user_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     ${where}
     ORDER BY s.revoked_at IS NOT NULL ASC, s.last_seen_at DESC
     LIMIT ${safeLimit}`,
  )
  return rows.map((row) => ({
    jti: row.jti,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    deviceLabel: row.device_label,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    status: row.revoked_at ? 'terminated' : 'active',
  }))
}

async function cleanupOldUserSessions(db) {
  await ensureUserSessionsSchema(db)
  await db.execute(
    `DELETE FROM user_sessions
     WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(NOW(), INTERVAL ? DAY))`,
    [SESSION_RETENTION_DAYS, SESSION_RETENTION_DAYS],
  )
}

module.exports = {
  SESSION_RETENTION_DAYS,
  ensureUserSessionsSchema,
  buildDeviceLabel,
  sessionMetaFromRequest,
  createUserSession,
  getSessionByJti,
  touchUserSession,
  revokeUserSession,
  revokeAllUserSessions,
  listUserSessions,
  cleanupOldUserSessions,
}
