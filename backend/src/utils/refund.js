const { isAdminRole } = require('../constants/permissions')
const {
  resolveStoredPasswordHash,
  verifyPassword,
  equalizeFailedLoginTiming,
} = require('./loginAuth')

const REFUNDABLE_STATUSES = new Set(['completed', 'paid'])

const APPROVAL_FAILURE_LIMIT = 5
const APPROVAL_WINDOW_MS = 15 * 60 * 1000

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function assertRefundable(order) {
  const status = String(order?.status || '').toLowerCase()
  if (status === 'refunded') throw httpError(400, 'Order has already been refunded')
  if (!REFUNDABLE_STATUSES.has(status)) {
    throw httpError(400, `Only paid orders can be refunded (this order is ${order?.status || 'unknown'})`)
  }
}

function createApprovalLimiter({ limit = APPROVAL_FAILURE_LIMIT, windowMs = APPROVAL_WINDOW_MS, now = Date.now } = {}) {
  const failures = new Map()

  function recent(key) {
    const cutoff = now() - windowMs
    const list = (failures.get(key) || []).filter((at) => at > cutoff)
    if (list.length) failures.set(key, list)
    else failures.delete(key)
    return list
  }

  return {
    isBlocked: (key) => recent(key).length >= limit,
    fail: (key) => failures.set(key, [...recent(key), now()]),
    reset: (key) => failures.delete(key),
  }
}

async function resolveRefundApprover(db, requester, { username, password } = {}, limiter = null) {
  if (isAdminRole(requester?.role)) return requester.id

  const name = String(username ?? '').trim()
  const plain = password == null ? '' : String(password)
  if (!name || !plain) {
    throw httpError(403, 'Manager authorization (Admin username & password) required to void or refund orders.')
  }

  const key = String(requester?.id ?? 'anonymous')
  if (limiter?.isBlocked(key)) {
    throw httpError(429, 'Too many failed manager approvals. Try again in 15 minutes.')
  }

  const [rows] = await db.execute(
    'SELECT id, role, is_active, password_hash FROM users WHERE username = ? LIMIT 1',
    [name],
  )
  const admin = rows[0]
  const hash = resolveStoredPasswordHash(admin)
  const valid = admin && hash
    ? await verifyPassword(plain, hash)
    : await equalizeFailedLoginTiming(plain)

  if (!valid || !isAdminRole(admin.role) || !Number(admin.is_active)) {
    limiter?.fail(key)
    throw httpError(403, 'Invalid manager credentials or insufficient permissions.')
  }

  limiter?.reset(key)
  return admin.id
}

module.exports = {
  REFUNDABLE_STATUSES,
  assertRefundable,
  createApprovalLimiter,
  resolveRefundApprover,
}
