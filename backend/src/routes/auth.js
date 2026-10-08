const express = require('express')
const db = require('../../db')
const { normalizePermissions } = require('../constants/permissions')
const { createPasswordResetLimiter } = require('../middleware/rateLimit')
const { JWT_SECRET, authenticateToken } = require('../middleware/auth')
const { getClientIp } = require('../utils/clientIp')
const { resolveRequestFingerprint } = require('../utils/deviceFingerprint')
const {
  normalizeLoginInput,
  resolveStoredPasswordHash,
  verifyPassword,
  equalizeFailedLoginTiming,
  assertJwtSecret,
} = require('../utils/loginAuth')
const {
  processLoginAttempt,
  applyLoginResult,
  createMysqlSecurityStore,
} = require('../utils/loginSecurity')
const {
  isDatabaseConnectionError,
  getDatabaseErrorMessage,
} = require('../utils/dbErrors')
const { writeAuditLog } = require('../utils/auditLog')
const { mustChangePassword } = require('../utils/accountPolicy')
const { logError, logSecurity } = require('../utils/logger')
const { sendSecurityAlertEmail } = require('../utils/mailer')
const { hashPassword } = require('../utils/userAccounts')
const { passwordPolicyError } = require('../utils/accountPolicy')
const {
  ensureSessionSecuritySchema,
  signSessionToken,
  revokePresentedToken,
  invalidateUserTokens,
} = require('../utils/sessionSecurity')
const {
  createUserSession,
  sessionMetaFromRequest,
} = require('../utils/userSessions')

const { createPasswordChangeReplayGuard } = require('../utils/passwordChangeReplay')

const publicAuthRouter = express.Router()
const passwordChangeReplay = createPasswordChangeReplayGuard()
const privateAuthRouter = express.Router()
const loginSecurityStore = createMysqlSecurityStore(db)

async function findLoginUser(username) {
  const [rows] = await db.execute(
    `SELECT id, display_name, username, role, permissions, password_hash,
            must_change_password, is_active
     FROM users WHERE BINARY username = ? LIMIT 1`,
    [username],
  )
  return rows[0] ?? null
}

function rejectPublicSignup(req, res) {
  logSecurity('public_signup_blocked', {
    ip: req.ip,
    path: req.originalUrl,
  })
  return res.status(403).json({
    message: 'Public registration is disabled. Ask an administrator to create your account in User Management.',
  })
}

function formatDeviceAudit(meta) {
  const device = meta?.deviceLabel || 'Unknown device'
  const ip = meta?.ip || 'unknown IP'
  return `device ${device}, IP ${ip}`
}

async function handleLogin(req, res) {
  const { normalizedUsername, plainPassword } = normalizeLoginInput(
    req.body?.username,
    req.body?.password,
  )

  if (!normalizedUsername || !plainPassword) {
    return res.status(400).json({ message: 'Please provide both username and password' })
  }

  try {
    await ensureSessionSecuritySchema(db)
    const outcome = await processLoginAttempt({
      username: normalizedUsername,
      password: plainPassword,
      ip: req.clientIp || getClientIp(req),
      fingerprint: req.deviceFingerprint || resolveRequestFingerprint(req),
      userAgent: req.get('user-agent') || '',
      acceptLanguage: req.get('accept-language') || '',
      store: loginSecurityStore,
      findUser: findLoginUser,
      verifyPassword: async (plain, storedHash) => {
        const hash = resolveStoredPasswordHash({ password_hash: storedHash })
        if (!hash) return false
        return verifyPassword(plain, hash)
      },
      equalizeFailedLoginTiming,
      onSecurityAlert: (alert) => sendSecurityAlertEmail(alert),
    })

    if (!outcome.ok) {
      return applyLoginResult(res, outcome)
    }

    const user = outcome.user
    if (Number(user.is_active) === 0) {
      return res.status(401).json({ message: 'Username or password is incorrect.' })
    }

    const userPermissions = normalizePermissions(user.permissions)
    assertJwtSecret(JWT_SECRET)
    const { token, jti } = await signSessionToken(db, user)
    const sessionMeta = await createUserSession(db, { jti, userId: user.id, req })

    await writeAuditLog(db, {
      userId: user.id,
      userRole: user.role,
      username: user.username,
      action: 'login',
      module: 'Auth',
      description: `User ${user.username} signed in (${formatDeviceAudit(sessionMeta)})`,
    })

    logSecurity('login_success', { ip: req.ip, username: user.username, userId: user.id })

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        display_name: user.display_name,
        username: user.username,
        role: user.role,
        permissions: userPermissions,
        must_change_password: mustChangePassword(user),
      },
    })
  } catch (error) {
    logError(error, { route: 'POST /api/auth/login' })

    if (isDatabaseConnectionError(error)) {
      return res.status(503).json({ message: getDatabaseErrorMessage(error) })
    }

    if (error.message === 'JWT_SECRET is not configured') {
      return res.status(500).json({ message: 'Server authentication is misconfigured' })
    }

    res.status(500).json({ message: 'Internal server error occurred during login' })
  }
}

async function handleForgotPassword(req, res) {
  logSecurity('password_reset_public_blocked', {
    ip: req.ip,
    path: req.originalUrl,
  })
  return res.status(403).json({
    message: 'Password reset is only available to an administrator in User Management.',
  })
}

async function handleChangePassword(req, res) {
  const currentPassword = String(req.body?.currentPassword ?? '')
  const password = String(req.body?.password ?? '')
  const confirmPassword = String(req.body?.confirmPassword ?? '')
  const policyError = passwordPolicyError(password)

  if (!currentPassword) {
    return res.status(400).json({ message: 'Current password is required.' })
  }
  if (policyError) {
    return res.status(400).json({ message: policyError })
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match.' })
  }

  let connection
  try {
    connection = await db.getConnection()
    await connection.beginTransaction()

    const [rows] = await connection.execute(
      `SELECT id, display_name, username, role, permissions, password_hash
       FROM users WHERE id = ? LIMIT 1 FOR UPDATE`,
      [req.user.id],
    )
    if (!rows.length) {
      await connection.rollback()
      return res.status(404).json({ message: 'User not found.' })
    }

    const row = rows[0]
    const storedHash = resolveStoredPasswordHash(row)
    const currentMatches = storedHash
      ? await verifyPassword(currentPassword, storedHash)
      : false
    const sessionJti = req.tokenClaims?.jti || null
    const newAlreadyStored = !currentMatches && storedHash
      ? await verifyPassword(password, storedHash)
      : false
    const isReplay = newAlreadyStored && passwordChangeReplay.isReplay(row.id, sessionJti)

    if (newAlreadyStored && !isReplay) {
      await connection.rollback()
      return res.status(400).json({
        message: 'Choose a new password that is different from your current password.',
      })
    }

    if (!currentMatches && !isReplay) {
      await connection.rollback()
      return res.status(400).json({ message: 'Current password is incorrect.' })
    }

    if (currentMatches && currentPassword === password) {
      await connection.rollback()
      return res.status(400).json({
        message: 'Choose a new password that is different from your current password.',
      })
    }

    if (currentMatches) {
      const passwordHash = await hashPassword(password)
      await connection.execute(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [passwordHash, row.id],
      )
    } else {
      await connection.execute(
        'UPDATE users SET must_change_password = 0 WHERE id = ?',
        [row.id],
      )
    }

    await connection.commit()

    await invalidateUserTokens(db, row.id, row.id)
    const sessionUser = {
      id: row.id,
      display_name: row.display_name,
      username: row.username,
      role: row.role,
      permissions: normalizePermissions(row.permissions),
    }
    const { token, jti } = await signSessionToken(db, sessionUser)
    await createUserSession(db, { jti, userId: row.id, req })
    if (currentMatches) passwordChangeReplay.record(row.id, sessionJti)

    await writeAuditLog(db, {
      userId: row.id,
      userRole: row.role,
      username: row.username,
      action: 'password_changed',
      module: 'Auth',
      description: `User ${row.username} changed their password`,
    })

    return res.status(200).json({
      message: 'Password updated',
      token,
      user: {
        ...sessionUser,
        must_change_password: false,
      },
    })
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback()
      } catch {
        /* ignore rollback errors */
      }
    }
    logError(error, { route: 'POST /api/auth/change-password' })
    if (isDatabaseConnectionError(error)) {
      return res.status(503).json({ message: getDatabaseErrorMessage(error) })
    }
    return res.status(500).json({ message: 'Something went wrong' })
  } finally {
    if (connection) connection.release()
  }
}

publicAuthRouter.post('/login', handleLogin)
publicAuthRouter.post('/forgot-password', createPasswordResetLimiter(), handleForgotPassword)
publicAuthRouter.post('/register', rejectPublicSignup)
publicAuthRouter.post('/signup', rejectPublicSignup)
publicAuthRouter.get('/register', rejectPublicSignup)
publicAuthRouter.get('/signup', rejectPublicSignup)

privateAuthRouter.get('/me', authenticateToken, async (req, res) => {
  res.status(200).json({ user: req.user })
})

privateAuthRouter.post('/change-password', createPasswordResetLimiter(), authenticateToken, handleChangePassword)

privateAuthRouter.post('/logout', authenticateToken, async (req, res) => {
  const meta = sessionMetaFromRequest(req)
  try {
    await revokePresentedToken(db, req.tokenClaims, req.user?.id, req.user?.id)
  } catch (error) {
    logError(error, { route: 'POST /api/auth/logout' })
  }

  await writeAuditLog(db, {
    userId: req.user?.id ?? null,
    userRole: req.user?.role ?? null,
    username: req.user?.username || req.user?.id,
    action: 'logout',
    module: 'Auth',
    description: `User ${req.user?.username || req.user?.id} signed out (${formatDeviceAudit(meta)})`,
  })
  res.status(200).json({ message: 'Logged out' })
})

module.exports = {
  publicAuthRouter,
  privateAuthRouter,
  rejectPublicSignup,
}
