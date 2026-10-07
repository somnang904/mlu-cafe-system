const jwt = require('jsonwebtoken')
const db = require('../../db')
const { env } = require('../config/env')
const {
  isAdminRole,
  userHasPermission,
  normalizePermissions,
} = require('../constants/permissions')
const { mustChangePassword } = require('../utils/accountPolicy')
const {
  ensureSessionSecuritySchema,
  isJtiRevoked,
  tokenIssuedBeforeCutoff,
  shouldRenewToken,
  renewSessionToken,
  RENEWED_TOKEN_HEADER,
} = require('../utils/sessionSecurity')
const {
  getSessionByJti,
  touchUserSession,
} = require('../utils/userSessions')

const JWT_SECRET = env.jwtSecret

// A database outage must not look like a bad token: the client signs the user out on 401.
const DB_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'ER_LOCK_WAIT_TIMEOUT',
])

function isDatabaseOutage(error) {
  if (!error) return false
  if (DB_ERROR_CODES.has(error.code)) return true
  // mysql2 wraps pool failures without always keeping the original code.
  return error.fatal === true || /ECONNREFUSED|connection lost|pool is closed/i.test(error.message || '')
}

async function loadUserById(userId) {
  await ensureSessionSecuritySchema(db)
  const [rows] = await db.execute(
    `SELECT id, display_name, username, role, permissions,
            must_change_password, is_active, tokens_valid_after
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  )

  if (!rows.length) return null

  const row = rows[0]
  return {
    id: row.id,
    display_name: row.display_name,
    username: row.username,
    role: row.role,
    permissions: normalizePermissions(row.permissions),
    must_change_password: mustChangePassword(row),
    is_active: row.is_active == null ? true : Number(row.is_active) === 1,
    tokens_valid_after: row.tokens_valid_after,
  }
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization
  if (!authHeader) return null
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  return token
}

async function authenticateToken(req, res, next) {
  const token = extractBearerToken(req)
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' })
  }

  try {
    // Pinning the algorithm blocks "alg" confusion attacks against a tampered token.
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    const user = await loadUserById(decoded.id)
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Invalid or expired session token' })
    }

    if (!decoded.jti) {
      return res.status(401).json({ message: 'Invalid or expired session token' })
    }

    const sessionRow = await getSessionByJti(db, decoded.jti)
    if (!sessionRow) {
      return res.status(401).json({ message: 'Invalid or expired session token' })
    }
    if (sessionRow.revoked_at) {
      return res.status(401).json({
        message: 'Your session was ended by an administrator.',
        code: 'SESSION_TERMINATED',
      })
    }

    if (await isJtiRevoked(db, decoded.jti)) {
      return res.status(401).json({ message: 'Invalid or expired session token' })
    }

    if (tokenIssuedBeforeCutoff(decoded.iat, user.tokens_valid_after)) {
      return res.status(401).json({ message: 'Invalid or expired session token' })
    }

    req.user = {
      id: user.id,
      display_name: user.display_name,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      must_change_password: user.must_change_password,
    }
    req.tokenClaims = { jti: decoded.jti, exp: decoded.exp, iat: decoded.iat }
    req.auth = { id: user.id, username: user.username, role: user.role }

    touchUserSession(db, decoded.jti).catch(() => {})

    if (shouldRenewToken(decoded.iat)) {
      const renewed = renewSessionToken(user, decoded.jti)
      res.setHeader(RENEWED_TOKEN_HEADER, renewed)
    }

    return next()
  } catch (error) {
    if (isDatabaseOutage(error)) {
      console.error('❌ AUTH DATABASE ERROR:', error.code || error.message)
      return res.status(503).json({
        message: 'The server is temporarily unavailable. Please try again in a moment.',
        code: 'DATABASE_UNAVAILABLE',
      })
    }
    return res.status(401).json({ message: 'Invalid or expired session token' })
  }
}

function rejectUntilPasswordChanged(req, res, next) {
  if (!req.user?.must_change_password) return next()
  const path = req.path || ''
  if (path === '/auth/change-password' || path === '/auth/logout' || path === '/auth/me') {
    return next()
  }
  return res.status(403).json({
    message: 'You must change your password before continuing.',
    code: 'PASSWORD_CHANGE_REQUIRED',
  })
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdminRole(req.user.role)) {
    return res.status(403).json({ message: 'Administrator access required' })
  }
  return next()
}

function requirePermission(permissionId) {
  return (req, res, next) => {
    if (!userHasPermission(req.user, permissionId)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action' })
    }
    return next()
  }
}

function requireAnyPermission(...permissionIds) {
  return (req, res, next) => {
    const allowed = permissionIds.some((permissionId) => userHasPermission(req.user, permissionId))
    if (!allowed) {
      return res.status(403).json({ message: 'You do not have permission to perform this action' })
    }
    return next()
  }
}

module.exports = {
  JWT_SECRET,
  loadUserById,
  authenticateToken,
  rejectUntilPasswordChanged,
  requireAdmin,
  requirePermission,
  requireAnyPermission,
}
