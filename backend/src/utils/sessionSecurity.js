const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { env } = require('../config/env')
const { buildTokenPayload, assertJwtSecret } = require('./loginAuth')
const {
  ensureUserSessionsSchema,
  revokeUserSession,
  revokeAllUserSessions,
  cleanupOldUserSessions,
} = require('./userSessions')

/** Absolute JWT lifetime. Raising this makes sessions effectively permanent for active users. */
const SESSION_DAYS = 30
/** Re-issue a fresh JWT (same jti) when the presented token's iat is older than this. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000
const RENEWED_TOKEN_HEADER = 'X-Renewed-Token'
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const REVOKED_ROW_FALLBACK_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

const { registerSchemaReset } = require('./schemaReset')
let schemaReady = null
registerSchemaReset(() => {
  schemaReady = null
})

async function columnExists(db, column) {
  const [columns] = await db.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
    [column],
  )
  return columns.length > 0
}

async function ensureSessionSecuritySchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS revoked_tokens (
          jti VARCHAR(64) NOT NULL PRIMARY KEY,
          user_id INT NOT NULL,
          expires_at DATETIME NOT NULL,
          revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_revoked_tokens_expires (expires_at),
          KEY idx_revoked_tokens_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)

      if (!(await columnExists(db, 'must_change_password'))) {
        await db.execute(
          'ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0',
        )
      }
      if (!(await columnExists(db, 'is_active'))) {
        await db.execute(
          'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
        )
      }
      if (!(await columnExists(db, 'tokens_valid_after'))) {
        await db.execute('ALTER TABLE users ADD COLUMN tokens_valid_after INT UNSIGNED NULL')
      } else {
        const [types] = await db.execute(
          `SELECT DATA_TYPE FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'tokens_valid_after'`,
        )
        if (String(types[0]?.DATA_TYPE || '').toLowerCase() !== 'int') {
          await db.execute('UPDATE users SET tokens_valid_after = NULL')
          await db.execute('ALTER TABLE users MODIFY COLUMN tokens_valid_after INT UNSIGNED NULL')
        }
      }

      await ensureUserSessionsSchema(db)

      await db.execute(`
        UPDATE admin_notifications
        SET meta = JSON_REMOVE(meta, '$.temporaryPassword', '$.password', '$.temporary_password')
        WHERE JSON_VALID(meta)
          AND (
            JSON_EXTRACT(meta, '$.temporaryPassword') IS NOT NULL
            OR JSON_EXTRACT(meta, '$.password') IS NOT NULL
            OR JSON_EXTRACT(meta, '$.temporary_password') IS NOT NULL
          )
      `).catch(() => {
        // The notifications table is created on startup as well. A missing table
        // is filled in by that schema step; the strip runs again on the next boot.
      })
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

function signTokenForUser(user, jti) {
  const secret = assertJwtSecret(env.jwtSecret)
  return jwt.sign(
    { ...buildTokenPayload(user), jti: String(jti).slice(0, 64) },
    secret,
    { expiresIn: `${SESSION_DAYS}d`, algorithm: 'HS256' },
  )
}

async function signSessionToken(db, user, { jti } = {}) {
  await ensureSessionSecuritySchema(db)
  const tokenId = jti || crypto.randomUUID()
  return {
    token: signTokenForUser(user, tokenId),
    jti: String(tokenId).slice(0, 64),
  }
}

function shouldRenewToken(iat, nowMs = Date.now()) {
  if (iat == null) return false
  const issuedAtMs = Number(iat) * 1000
  if (!Number.isFinite(issuedAtMs)) return false
  return nowMs - issuedAtMs >= RENEW_AFTER_MS
}

function renewSessionToken(user, jti) {
  return signTokenForUser(user, jti)
}

function tokenIssuedBeforeCutoff(iat, validAfter) {
  const cutoff = Number(validAfter)
  if (!Number.isFinite(cutoff) || cutoff <= 0 || iat == null) return false
  return Number(iat) < cutoff
}

async function isJtiRevoked(db, jti) {
  if (!jti) return true
  const [rows] = await db.execute(
    'SELECT 1 FROM revoked_tokens WHERE jti = ? LIMIT 1',
    [String(jti).slice(0, 64)],
  )
  return rows.length > 0
}

async function revokePresentedToken(db, claims, userId, revokedBy = null) {
  if (!claims?.jti || !userId) return
  await ensureSessionSecuritySchema(db)
  const expiresAt = claims.exp
    ? new Date(Number(claims.exp) * 1000)
    : new Date(Date.now() + REVOKED_ROW_FALLBACK_MS)
  await db.execute(
    `INSERT INTO revoked_tokens (jti, user_id, expires_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [String(claims.jti).slice(0, 64), userId, expiresAt],
  )
  await revokeUserSession(db, claims.jti, revokedBy ?? userId)
}

async function invalidateUserTokens(db, userId, revokedBy = null) {
  await ensureSessionSecuritySchema(db)
  await db.execute('UPDATE users SET tokens_valid_after = UNIX_TIMESTAMP() WHERE id = ?', [userId])
  await revokeAllUserSessions(db, userId, revokedBy ?? userId)
}

function startRevokedTokenCleanup(db) {
  const run = async () => {
    try {
      await db.execute('DELETE FROM revoked_tokens WHERE expires_at < NOW()')
      await cleanupOldUserSessions(db)
    } catch (error) {
      console.error('Session cleanup failed:', error.message)
    }
  }

  run()
  const timer = setInterval(run, CLEANUP_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}

module.exports = {
  SESSION_DAYS,
  RENEW_AFTER_MS,
  RENEWED_TOKEN_HEADER,
  ensureSessionSecuritySchema,
  signSessionToken,
  shouldRenewToken,
  renewSessionToken,
  tokenIssuedBeforeCutoff,
  isJtiRevoked,
  revokePresentedToken,
  invalidateUserTokens,
  startRevokedTokenCleanup,
}
