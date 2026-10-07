const test = require('node:test')
const assert = require('node:assert/strict')

const { createPasswordChangeReplayGuard } = require('../src/utils/passwordChangeReplay')

test('only the same session within 10 seconds counts as a repeated password change', () => {
  const guard = createPasswordChangeReplayGuard()
  const start = Date.parse('2026-10-07T00:00:00Z')

  assert.equal(guard.isReplay(7, 'jti-a', start), false, 'a temporary password is never an idempotent repeat')

  guard.record(7, 'jti-a', start)
  assert.equal(guard.isReplay(7, 'jti-a', start + 5000), true)
  assert.equal(guard.isReplay(7, 'jti-b', start + 5000), false)
  assert.equal(guard.isReplay(8, 'jti-a', start + 5000), false)
  assert.equal(guard.isReplay(7, 'jti-a', start + 10001), false)
  assert.equal(guard.isReplay(7, null, start), false)
})
