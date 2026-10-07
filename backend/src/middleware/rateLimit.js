const rateLimit = require('express-rate-limit')
const { ipKeyGenerator } = require('express-rate-limit')
const { env } = require('../config/env')
const { logSecurity } = require('../utils/logger')

const FIFTEEN_MINUTES = 15 * 60 * 1000

/** Public reset and admin password-reset routes. Counts every request. */
function createPasswordResetLimiter() {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      logSecurity('password_reset_rate_limited', { ip: req.ip, route: req.originalUrl })
      res.status(429).json({
        message: 'Too many password reset attempts. Please wait and try again.',
      })
    },
  })
}

const passwordResetLimiter = createPasswordResetLimiter()

/** Broad ceiling for the authenticated API surface. */
const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: env.security.apiRequestLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurity('api_rate_limited', { ip: req.ip, route: req.originalUrl })
    res.status(429).json({ message: 'Too many requests. Please slow down and try again shortly.' })
  },
})

/** Tighter ceiling for expensive or destructive operations (backup, restore, exports). */
const sensitiveOperationLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: env.security.sensitiveOperationLimit,
  keyGenerator: (req) => (req.user?.id != null ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurity('sensitive_rate_limited', { ip: req.ip, userId: req.user?.id ?? null, route: req.originalUrl })
    res.status(429).json({ message: 'Too many requests for this operation. Try again later.' })
  },
})

/** Session and idle-timeout changes. Counts every request, including rejected values. */
const settingsWriteLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurity('settings_rate_limited', { ip: req.ip, route: req.originalUrl })
    res.status(429).json({ message: 'Too many settings changes. Please wait and try again.' })
  },
})

module.exports = {
  passwordResetLimiter,
  createPasswordResetLimiter,
  apiLimiter,
  sensitiveOperationLimiter,
  settingsWriteLimiter,
}
