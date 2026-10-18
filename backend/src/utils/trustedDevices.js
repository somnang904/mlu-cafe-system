const db = require('../../db')
const { ensureLoginSecuritySchema } = require('./loginSecurity')

// A device id that has made a signed-in request is a real user's device. Group blocks (same
// network + same phone/computer type) skip such devices, so blocking an attacker's phone never
// locks out a staff phone on the same Wi-Fi.
const WRITE_EVERY_MS = 10 * 60 * 1000
const lastWrite = new Map()

async function noteTrustedDevice(fingerprint, userId, database = db) {
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ''))) return
  const now = Date.now()
  if (now - (lastWrite.get(fingerprint) || 0) < WRITE_EVERY_MS) return
  lastWrite.set(fingerprint, now)
  try {
    await ensureLoginSecuritySchema(database)
    await database.execute(
      `INSERT INTO trusted_devices (device_fingerprint, user_id, first_seen_at, last_seen_at)
       VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), last_seen_at = NOW()`,
      [fingerprint, userId || null],
    )
  } catch {
    lastWrite.delete(fingerprint) // try again on the next request
  }
}

module.exports = { noteTrustedDevice }
