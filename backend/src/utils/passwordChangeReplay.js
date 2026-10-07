const REPLAY_WINDOW_MS = 10 * 1000

function createPasswordChangeReplayGuard({ windowMs = REPLAY_WINDOW_MS } = {}) {
  const recent = new Map()

  return {
    record(userId, jti, nowMs = Date.now()) {
      if (!jti) return
      recent.set(String(userId), { jti: String(jti), at: nowMs })
    },

    isReplay(userId, jti, nowMs = Date.now()) {
      const entry = recent.get(String(userId))
      if (!entry || !jti) return false
      if (nowMs - entry.at > windowMs) {
        recent.delete(String(userId))
        return false
      }
      return entry.jti === String(jti)
    },
  }
}

module.exports = { REPLAY_WINDOW_MS, createPasswordChangeReplayGuard }
