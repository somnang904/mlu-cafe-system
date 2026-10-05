const test = require('node:test')
const assert = require('node:assert/strict')
const {
  splitChange,
  normalizeCheckoutPayment,
  cashDrawerDelta,
  summarizeCashOrders,
  computeCashDifference,
} = require('../src/utils/cashDrawer')

const cash = (fields) => normalizeCheckoutPayment({ method: 'Cash', exchangeRate: 4100, ...fields })

function rejects(fn, pattern) {
  assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message))
}

test('exact USD cash is accepted with no change', () => {
  assert.deepEqual(cash({ totalUsd: 3, receivedUsd: 3, receivedKhr: 0, changeUsd: 0 }), {
    received_usd: 3,
    received_khr: 0,
    change_usd: 0,
    change_khr: 0,
    exchange_rate: 4100,
  })
})

test('blank received fields mean exact USD, like the payment screen', () => {
  const payment = cash({ totalUsd: 4.5, receivedUsd: null, receivedKhr: null, changeUsd: null })
  assert.equal(payment.received_usd, 4.5)
  assert.equal(payment.received_khr, 0)
  assert.equal(payment.change_usd, 0)
})

test('exact riel rounded down to the 100 note is accepted', () => {
  const payment = cash({ totalUsd: 2.25, receivedUsd: 0, receivedKhr: 9200, changeUsd: 0 })
  assert.equal(payment.received_khr, 9200)
  assert.equal(payment.change_usd, 0)
})

test('underpayment is rejected', () => {
  rejects(() => cash({ totalUsd: 3, receivedUsd: 1, receivedKhr: 0, changeUsd: 0 }), /does not cover/)
  rejects(() => cash({ totalUsd: 3, receivedUsd: 0, receivedKhr: 12200, changeUsd: 0 }), /does not cover/)
})

test('mixed USD + riel payment computes change on the combined amount', () => {
  const payment = cash({ totalUsd: 3, receivedUsd: 2, receivedKhr: 6000, changeUsd: 0.46 })
  assert.equal(payment.change_usd, 0.46)
  assert.equal(payment.change_khr, 1900)
})

test('change claimed by the browser must match the server total', () => {
  rejects(() => cash({ totalUsd: 3, receivedUsd: 5, receivedKhr: 0, changeUsd: 50 }), /Change does not match/)
  rejects(() => cash({ totalUsd: 3, receivedUsd: 5, receivedKhr: 0, changeUsd: 2.5 }), /Change does not match/)
  assert.equal(cash({ totalUsd: 3.3, receivedUsd: 5, receivedKhr: 0, changeUsd: 1.7 }).change_usd, 1.7)
})

test('server overwrites the riel change with its own value', () => {
  const payment = cash({ totalUsd: 3, receivedUsd: 5, receivedKhr: 0, changeUsd: 2 })
  assert.equal(payment.change_khr, 8200)
})

test('negative, non-numeric and absurd inputs are rejected', () => {
  rejects(() => cash({ totalUsd: 3, receivedUsd: -5, receivedKhr: 0 }), /negative/)
  rejects(() => cash({ totalUsd: 3, receivedUsd: 'abc', receivedKhr: 0 }), /must be a number/)
  rejects(() => cash({ totalUsd: 3, receivedUsd: 0, receivedKhr: 12300, exchangeRate: 1 }), /exchange_rate/)
  rejects(() => cash({ totalUsd: 3, receivedUsd: 1e12, receivedKhr: 0 }), /too large/)
})

test('Bank Scan stores no cash fields, even if the client sent some', () => {
  const payment = normalizeCheckoutPayment({
    method: 'Bank Scan',
    totalUsd: 3,
    receivedUsd: 100,
    receivedKhr: 5000,
    changeUsd: 97,
    exchangeRate: 4100,
  })
  assert.deepEqual(payment, {
    received_usd: null,
    received_khr: null,
    change_usd: null,
    change_khr: null,
    exchange_rate: 4100,
  })
})

test('change: whole dollars in USD notes, cents in riel', () => {
  assert.deepEqual(splitChange(2, 4100), { usd: 2, khr: 0 })
  assert.deepEqual(splitChange(0.5, 4100), { usd: 0, khr: 2100 })
  assert.deepEqual(splitChange(1.75, 4100), { usd: 1, khr: 3100 })
  assert.deepEqual(splitChange(0, 4100), { usd: 0, khr: 0 })
})

test('a riel payment adds riel only, not the dollar total as well', () => {
  const delta = cashDrawerDelta({ total: 3, received_usd: 0, received_khr: 12300, change_usd: 0, change_khr: 0, exchange_rate: 4100 })
  assert.deepEqual(delta, { usd: 0, khr: 12300 })
})

test('riel change leaves the riel drawer', () => {
  const delta = cashDrawerDelta({ total: 1.5, received_usd: 2, received_khr: 0, change_usd: 0.5, change_khr: 2100, exchange_rate: 4100 })
  assert.deepEqual(delta, { usd: 2, khr: -2100 })
})

test('USD payment with whole-dollar change nets the bill in USD', () => {
  const delta = cashDrawerDelta({ total: 3, received_usd: 5, received_khr: 0, change_usd: 2, change_khr: 8200, exchange_rate: 4100 })
  assert.deepEqual(delta, { usd: 3, khr: 0 })
})

test('legacy orders without a cash breakdown count as exact USD', () => {
  assert.deepEqual(cashDrawerDelta({ total: 3.5, received_usd: null, received_khr: null }), { usd: 3.5, khr: 0 })
})

test('shift summary, expected cash and difference for a mixed shift', () => {
  const orders = [
    { total: 3, received_usd: 0, received_khr: 12300, change_usd: 0, change_khr: 0, exchange_rate: 4100 },
    { total: 3, received_usd: 5, received_khr: 0, change_usd: 2, change_khr: 8200, exchange_rate: 4100 },
    { total: 1.5, received_usd: 2, received_khr: 0, change_usd: 0.5, change_khr: 2100, exchange_rate: 4100 },
  ]
  const summary = summarizeCashOrders(orders)
  assert.deepEqual(summary, { salesUsd: 7.5, netUsd: 5, netKhr: 10200, exchangeRate: 4100 })

  assert.equal(20 + summary.netUsd - 1, 24)
  assert.equal(40000 + summary.netKhr, 50200)

  assert.deepEqual(
    computeCashDifference({ expectedUsd: 24, expectedKhr: 50200, countedUsd: 24, countedKhr: 50200, exchangeRate: 4100 }),
    { usd: 0, khr: 0, totalUsd: 0 },
  )
  assert.deepEqual(
    computeCashDifference({ expectedUsd: 24, expectedKhr: 50200, countedUsd: 23, countedKhr: 54300, exchangeRate: 4100 }),
    { usd: -1, khr: 4100, totalUsd: 0 },
  )
})
