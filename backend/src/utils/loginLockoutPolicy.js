/**
 * Login lockout.
 * 4 failures → the device is locked for 30 seconds and an admin alert is raised.
 * Once the lock expires the counter starts again from zero.
 */

const INVALID_CREDENTIALS_MESSAGE = 'Username or password is incorrect.'
const LOCKOUT_MESSAGE = 'Too many attempts. Please try again later.'

const LOCK_RULE = { failures: 4, lockMs: 30 * 1000 }

function emptyAttempt() {
  return { failedCount: 0, stage: 1, lockedUntil: null }
}

function applyExpiry(attempt, nowMs) {
  const current = attempt
    ? {
        failedCount: Number(attempt.failedCount) || 0,
        stage: 1,
        lockedUntil: attempt.lockedUntil ?? null,
      }
    : emptyAttempt()

  if (current.lockedUntil == null || current.lockedUntil > nowMs) {
    return current
  }

  return emptyAttempt()
}

function lockRemainingSeconds(attempt, nowMs) {
  if (!attempt?.lockedUntil || attempt.lockedUntil <= nowMs) return 0
  return Math.max(1, Math.ceil((attempt.lockedUntil - nowMs) / 1000))
}

function isLocked(attempt, nowMs) {
  return lockRemainingSeconds(attempt, nowMs) > 0
}

function registerFailure(attempt, nowMs) {
  const current = applyExpiry(attempt, nowMs)
  if (isLocked(current, nowMs)) {
    return { attempt: current, triggeredLock: false, triggeredAlert: false, alreadyLocked: true }
  }

  const failedCount = current.failedCount + 1

  if (failedCount >= LOCK_RULE.failures) {
    return {
      attempt: { failedCount, stage: 1, lockedUntil: nowMs + LOCK_RULE.lockMs },
      triggeredLock: true,
      triggeredAlert: true,
      alreadyLocked: false,
    }
  }

  return {
    attempt: { failedCount, stage: 1, lockedUntil: null },
    triggeredLock: false,
    triggeredAlert: false,
    alreadyLocked: false,
  }
}

module.exports = {
  INVALID_CREDENTIALS_MESSAGE,
  LOCKOUT_MESSAGE,
  LOCK_RULE,
  emptyAttempt,
  applyExpiry,
  lockRemainingSeconds,
  isLocked,
  registerFailure,
}
