const test = require('node:test')
const assert = require('node:assert/strict')

const { PAYMENT_BANKS, normalizePaymentBank } = require('../src/utils/paymentBanks')

test('a Bank Scan sale keeps a listed bank', () => {
  for (const bank of PAYMENT_BANKS) {
    assert.equal(normalizePaymentBank('Bank Scan', bank), bank)
  }
})

test('surrounding spaces on the bank are ignored', () => {
  assert.equal(normalizePaymentBank('Bank Scan', '  ABA '), 'ABA')
})

test('a Bank Scan sale without a bank is accepted and stores null', () => {
  assert.equal(normalizePaymentBank('Bank Scan', undefined), null)
  assert.equal(normalizePaymentBank('Bank Scan', null), null)
  assert.equal(normalizePaymentBank('Bank Scan', ''), null)
})

test('an unknown bank is rejected with a 400', () => {
  assert.throws(
    () => normalizePaymentBank('Bank Scan', 'Not A Bank'),
    (error) => error.status === 400 && /Invalid payment_bank/.test(error.message),
  )
})

test('cash never stores a bank, even if one is sent', () => {
  assert.equal(normalizePaymentBank('Cash', 'ABA'), null)
  assert.equal(normalizePaymentBank('Cash', 'Not A Bank'), null)
})

test('bank ids are case sensitive so stored values stay consistent', () => {
  assert.throws(() => normalizePaymentBank('Bank Scan', 'aba'), (error) => error.status === 400)
})
