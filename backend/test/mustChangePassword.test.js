const test = require('node:test')
const assert = require('node:assert/strict')

const { mustChangePassword } = require('../src/utils/accountPolicy')

test('a cashier is never held on the change-password screen, even with the flag set', () => {
  assert.equal(mustChangePassword({ role: 'Cashier', must_change_password: 1 }), false)
  assert.equal(mustChangePassword({ role: 'Cashier', must_change_password: true }), false)
})

test('legacy Staff and Supervisor rows with a stored flag are not held either', () => {
  assert.equal(mustChangePassword({ role: 'Staff', must_change_password: 1 }), false)
  assert.equal(mustChangePassword({ role: 'Supervisor', must_change_password: 1 }), false)
})

test('an admin flagged by the recovery script is still held', () => {
  assert.equal(mustChangePassword({ role: 'Admin', must_change_password: 1 }), true)
  assert.equal(mustChangePassword({ role: 'admin', must_change_password: '1' }), true)
})

test('an unflagged admin is not held', () => {
  assert.equal(mustChangePassword({ role: 'Admin', must_change_password: 0 }), false)
  assert.equal(mustChangePassword({ role: 'Admin', must_change_password: null }), false)
})

test('a missing row is not held', () => {
  assert.equal(mustChangePassword(null), false)
  assert.equal(mustChangePassword(undefined), false)
  assert.equal(mustChangePassword({}), false)
})
