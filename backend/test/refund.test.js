const test = require('node:test')
const assert = require('node:assert/strict')
const bcrypt = require('bcrypt')
const {
  assertRefundable,
  createApprovalLimiter,
  resolveRefundApprover,
} = require('../src/utils/refund')
const { planStockDeltas } = require('../src/utils/stockLedger')
const { expectedDrawerUsd } = require('../src/utils/shifts')

const PASSWORD = 'Manager#2026'
const hash = bcrypt.hashSync(PASSWORD, 4)

function fakeDb(users) {
  const calls = []
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params })
      if (/\bpassword\b(?!_)/.test(sql)) throw new Error("Unknown column 'password' in 'field list'")
      return [users.filter((u) => u.username === params[0])]
    },
  }
}

const admin = { id: 3, username: 'admin', role: 'Admin', is_active: 1, password_hash: hash }
const cashier = { id: 70, username: 'cashier', role: 'Staff', is_active: 1, password_hash: hash }

async function rejectsWith(promise, status) {
  await assert.rejects(promise, (error) => error.status === status)
}

test('an admin approves their own refund without typing credentials', async () => {
  const db = fakeDb([])
  assert.equal(await resolveRefundApprover(db, { id: 3, role: 'Admin' }, {}), 3)
  assert.equal(db.calls.length, 0)
})

test('a cashier is approved by a valid admin username and password', async () => {
  const db = fakeDb([admin, cashier])
  const id = await resolveRefundApprover(db, { id: 70, role: 'Staff' }, { username: ' admin ', password: PASSWORD })
  assert.equal(id, 3)
})

test('a cashier cannot approve with their own (non-admin) credentials', async () => {
  const db = fakeDb([admin, cashier])
  await rejectsWith(resolveRefundApprover(db, { id: 70, role: 'Staff' }, { username: 'cashier', password: PASSWORD }), 403)
})

test('wrong password, unknown user and disabled admin all fail with the same message', async () => {
  const db = fakeDb([admin, { ...admin, id: 9, username: 'old', is_active: 0 }])
  const requester = { id: 70, role: 'Staff' }
  const messages = []
  for (const creds of [
    { username: 'admin', password: 'wrong' },
    { username: 'ghost', password: PASSWORD },
    { username: 'old', password: PASSWORD },
  ]) {
    await assert.rejects(resolveRefundApprover(db, requester, creds), (error) => {
      messages.push(error.message)
      return error.status === 403
    })
  }
  assert.equal(new Set(messages).size, 1)
})

test('missing manager credentials are refused before any lookup', async () => {
  const db = fakeDb([admin])
  await rejectsWith(resolveRefundApprover(db, { id: 70, role: 'Staff' }, { username: 'admin' }), 403)
  assert.equal(db.calls.length, 0)
})

test('repeated wrong manager passwords lock the requester out, even with the right one', async () => {
  const db = fakeDb([admin])
  const limiter = createApprovalLimiter({ limit: 3, windowMs: 60_000 })
  const requester = { id: 70, role: 'Staff' }
  for (let i = 0; i < 3; i += 1) {
    await rejectsWith(resolveRefundApprover(db, requester, { username: 'admin', password: `guess${i}` }, limiter), 403)
  }
  await rejectsWith(resolveRefundApprover(db, requester, { username: 'admin', password: PASSWORD }, limiter), 429)
  assert.equal(await resolveRefundApprover(db, { id: 71, role: 'Staff' }, { username: 'admin', password: PASSWORD }, limiter), 3)
})

test('the approval lockout ends when the window passes, and success clears failures', async () => {
  let clock = 0
  const limiter = createApprovalLimiter({ limit: 2, windowMs: 1000, now: () => clock })
  limiter.fail('a')
  limiter.fail('a')
  assert.equal(limiter.isBlocked('a'), true)
  clock = 1001
  assert.equal(limiter.isBlocked('a'), false)
  limiter.fail('a')
  limiter.reset('a')
  limiter.fail('a')
  assert.equal(limiter.isBlocked('a'), false)
})

test('only paid orders can be refunded', () => {
  assert.doesNotThrow(() => assertRefundable({ status: 'Completed' }))
  assert.doesNotThrow(() => assertRefundable({ status: 'PAID' }))
  assert.throws(() => assertRefundable({ status: 'Refunded' }), /already been refunded/)
  for (const status of ['Pending', 'Split', 'Cancelled', '', null]) {
    assert.throws(() => assertRefundable({ status }), (error) => error.status === 400)
  }
})

test('refunding returns exactly what the order still holds', () => {
  const taken = new Map([[12, 2], [40, 0.75]])
  assert.deepEqual(planStockDeltas([], [], taken), [
    { inventoryId: 12, delta: -2 },
    { inventoryId: 40, delta: -0.75 },
  ])
  assert.deepEqual(planStockDeltas([], [], new Map([[12, 0]])), [])
})

test('cash refunded for an earlier shift comes out of the expected drawer', () => {
  const metrics = { cashSalesUsd: 20, expensesUsd: 2.5, cashRefundsUsd: 4.5 }
  assert.equal(expectedDrawerUsd(100, metrics), 113)
  assert.equal(expectedDrawerUsd(100, { cashSalesUsd: 20, expensesUsd: 2.5 }), 117.5)
})
