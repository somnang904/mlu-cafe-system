const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeIncomingTarget,
  validateOrderLine,
  withLineQuantities,
  assertItemsOnSale,
  INVOICE_LOCK_NAME,
  pendingOrderLockName,
} = require('../src/utils/orderTargets')
const { normalizeCheckoutPayment } = require('../src/utils/cashDrawer')
const { withTransaction } = require('../src/utils/stockLedger')

const menuLine = (quantity, key = 'quantity') => ({ menu_item_id: 5, name: 'Coffee', [key]: quantity })

test('only whole quantities from 1 to 999 pass line validation', () => {
  for (const good of [1, 2, 999, '3']) {
    assert.equal(validateOrderLine(menuLine(good), { isAdmin: false }), null, String(good))
  }
  for (const bad of [0, -1, 1.5, 1e-9, 1e10, 99999, 1000, 'abc', '1.5', '2e1', null, undefined, NaN, Infinity]) {
    assert.match(validateOrderLine(menuLine(bad), { isAdmin: false }), /whole quantity from 1 to 999/, String(bad))
  }
})

test('the qty alias is validated and normalised the same way as quantity', () => {
  assert.equal(validateOrderLine(menuLine(3, 'qty'), { isAdmin: false }), null)
  assert.match(validateOrderLine(menuLine(1.5, 'qty'), { isAdmin: false }), /whole quantity/)
  const [line] = withLineQuantities([menuLine('4', 'qty')])
  assert.equal(line.quantity, 4)
})

test('table targets must be plain digits', () => {
  assert.equal(normalizeIncomingTarget('3').tableId, 3)
  assert.equal(normalizeIncomingTarget(' 03 ').tableId, 3)
  assert.equal(normalizeIncomingTarget(7).tableId, 7)
  assert.equal(normalizeIncomingTarget('Take Out').sourceType, 'Take Out')
  for (const bad of ['abc3', '3abc', '3.5', '-3', '0', '1e2', '3 4', '99999999999999999999', '2147483648']) {
    assert.throws(() => normalizeIncomingTarget(bad), /Invalid order target/, bad)
  }
})

test('cash received is capped at 1,000,000 USD and 4,000,000,000 KHR', () => {
  const pay = (receivedUsd, receivedKhr) =>
    normalizeCheckoutPayment({ method: 'Cash', totalUsd: 3, receivedUsd, receivedKhr, changeUsd: null, exchangeRate: 4000 })
  assert.equal(pay(1000000, 0).received_usd, 1000000)
  assert.throws(() => pay(1000001, 0), /too large/)
  assert.throws(() => pay(0, 4000000001), /too large/)
})

test('the invoice lock sorts before every pending-order lock so lock order never inverts', () => {
  const names = [pendingOrderLockName({ key: '2' }), INVOICE_LOCK_NAME, pendingOrderLockName({ key: 'takeout' })]
  assert.equal([...names].sort()[0], INVOICE_LOCK_NAME)
})

test('the invoice lock is released after a failed transaction too', async () => {
  const log = []
  const conn = {
    async query(sql, params) {
      log.push(sql.includes('GET_LOCK') ? `lock ${params[0]}` : `unlock ${params[0]}`)
      return [[{ ok: 1 }]]
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() { log.push('rollback') },
    release() {},
  }
  await assert.rejects(
    withTransaction({ getConnection: async () => conn }, async () => { throw new Error('boom') }, {
      locks: [pendingOrderLockName({ key: '2' }), INVOICE_LOCK_NAME],
    }),
    /boom/,
  )
  assert.deepEqual(log, [
    `lock ${INVOICE_LOCK_NAME}`,
    'lock pending-order:2',
    'rollback',
    'unlock pending-order:2',
    `unlock ${INVOICE_LOCK_NAME}`,
  ])
})

function menuDb({ offSale = [], onBill = [] }) {
  return {
    async execute(sql) {
      if (sql.includes('FROM menu_items')) return [offSale]
      if (sql.includes('FROM order_items')) return [onBill]
      throw new Error(`unexpected ${sql}`)
    },
  }
}

test('off-sale items are refused with a 409 that names them', async () => {
  const db = menuDb({ offSale: [{ id: 5, name: 'Coffee' }] })
  await assert.rejects(assertItemsOnSale(db, [menuLine(1)]), (error) => {
    assert.equal(error.status, 409)
    assert.match(error.message, /Coffee/)
    return true
  })
})

test('off-sale items already on the bill may stay but not grow', async () => {
  const db = menuDb({ offSale: [{ id: 5, name: 'Coffee' }], onBill: [{ menu_item_id: 5, qty: '2' }] })
  await assertItemsOnSale(db, [menuLine(2)], 10)
  await assert.rejects(assertItemsOnSale(db, [menuLine(3)], 10), /Coffee/)
})

test('lines for items on sale pass and custom lines are ignored', async () => {
  await assertItemsOnSale(menuDb({}), [menuLine(1), { name: 'Custom', price: 2, quantity: 1 }])
})
