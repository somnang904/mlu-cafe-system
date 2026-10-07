const INVALID_CREDENTIALS_MESSAGE = 'Username or password is incorrect.'
const LOCKOUT_MESSAGE = 'Too many attempts. Please try again later.'

const SCOPE_DEVICE = 'device'
const SCOPE_IP = 'ip'
const SCOPE_USER = 'user'

const FAILURE_WINDOW_MS = 15 * 60 * 1000
const LOCK_LADDER_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000]
const LEVEL_RESET_MS = 60 * 60 * 1000
const ALERT_COOLDOWN_MS = 10 * 60 * 1000

const LOCK_RULE = {
  failures: 4,
  lockMs: LOCK_LADDER_MS[0],
  userWideFailures: 20,
  userWideLockMs: 15 * 60 * 1000,
}

function emptyAttempt() {
  return { failedCount: 0, stage: 1, lockedUntil: null, windowStartedAt: null }
}

function normalizeAttempt(attempt) {
  if (!attempt) return emptyAttempt()
  return {
    failedCount: Number(attempt.failedCount) || 0,
    stage: Math.min(LOCK_LADDER_MS.length, Math.max(1, Number(attempt.stage) || 1)),
    lockedUntil: attempt.lockedUntil ?? null,
    windowStartedAt: attempt.windowStartedAt ?? null,
  }
}

function applyExpiry(attempt, nowMs) {
  const current = normalizeAttempt(attempt)

  if (current.lockedUntil != null && current.lockedUntil > nowMs) {
    return current
  }

  if (current.lockedUntil != null) {
    if (nowMs - current.lockedUntil >= LEVEL_RESET_MS) return emptyAttempt()
    const restarted =
      current.windowStartedAt != null && current.windowStartedAt > current.lockedUntil
    if (!restarted) {
      return {
        failedCount: 0,
        stage: current.stage,
        lockedUntil: current.lockedUntil,
        windowStartedAt: null,
      }
    }
  }

  if (current.windowStartedAt != null && nowMs - current.windowStartedAt >= FAILURE_WINDOW_MS) {
    return {
      failedCount: 0,
      stage: current.stage,
      lockedUntil: current.lockedUntil,
      windowStartedAt: null,
    }
  }

  return current
}

function lockRemainingSeconds(attempt, nowMs) {
  if (!attempt?.lockedUntil || attempt.lockedUntil <= nowMs) return 0
  return Math.max(1, Math.ceil((attempt.lockedUntil - nowMs) / 1000))
}

function isLocked(attempt, nowMs) {
  return lockRemainingSeconds(attempt, nowMs) > 0
}

function registerFailure(attempt, nowMs, scopeKind = SCOPE_DEVICE) {
  const current = applyExpiry(attempt, nowMs)
  if (isLocked(current, nowMs)) {
    return { attempt: current, triggeredLock: false, triggeredAlert: false, alreadyLocked: true }
  }

  const failedCount = current.failedCount + 1
  const windowStartedAt = current.windowStartedAt ?? nowMs
  const threshold = scopeKind === SCOPE_USER ? LOCK_RULE.userWideFailures : LOCK_RULE.failures

  if (failedCount >= threshold) {
    if (scopeKind === SCOPE_USER) {
      return {
        attempt: {
          failedCount,
          stage: 1,
          lockedUntil: nowMs + LOCK_RULE.userWideLockMs,
          windowStartedAt,
        },
        triggeredLock: true,
        triggeredAlert: true,
        alreadyLocked: false,
      }
    }

    const hadLock = current.lockedUntil != null
    const stage = hadLock ? Math.min(LOCK_LADDER_MS.length, current.stage + 1) : 1
    return {
      attempt: {
        failedCount,
        stage,
        lockedUntil: nowMs + LOCK_LADDER_MS[stage - 1],
        windowStartedAt,
      },
      triggeredLock: true,
      triggeredAlert: true,
      alreadyLocked: false,
    }
  }

  return {
    attempt: { failedCount, stage: current.stage, lockedUntil: current.lockedUntil, windowStartedAt },
    triggeredLock: false,
    triggeredAlert: false,
    alreadyLocked: false,
  }
}

module.exports = {
  INVALID_CREDENTIALS_MESSAGE,
  LOCKOUT_MESSAGE,
  LOCK_RULE,
  LOCK_LADDER_MS,
  FAILURE_WINDOW_MS,
  LEVEL_RESET_MS,
  ALERT_COOLDOWN_MS,
  SCOPE_DEVICE,
  SCOPE_IP,
  SCOPE_USER,
  emptyAttempt,
  applyExpiry,
  lockRemainingSeconds,
  isLocked,
  registerFailure,
}
