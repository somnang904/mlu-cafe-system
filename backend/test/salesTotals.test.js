const test = require('node:test')
const assert = require('node:assert/strict')
const {
  formatRefundMoney,
  mergeSalesAndRefunds,
  refundDateSql,
  refundedStatusSql,
  saleStatusSql,
  salesAndRefunds,
} = require('../src/utils/salesTotals')

test('sales count refunded orders by sale date and refunds fall back to updated_at', () => {
  assert.equal(saleStatusSql(), `UPPER(status) IN ('COMPLETED', 'PAID', 'REFUNDED')`)
  assert.equal(saleStatusSql('o'), `UPPER(o.status) IN ('COMPLETED', 'PAID', 'REFUNDED')`)
  assert.equal(refundedStatusSql('o'), `UPPER(o.status) = 'REFUNDED'`)
  assert.equal(refundDateSql(), 'COALESCE(voided_at, updated_at)')
  assert.equal(refundDateSql('o'), 'COALESCE(o.voided_at, o.updated_at)')
})

test('net is sales minus refunds', () => {
  assert.deepEqual(
    salesAndRefunds({ orders: '40', sales: '5000', refundOrders: 1, refunds: '12.5' }),
    { orders: 40, sales: 5000, refundOrders: 1, refunds: 12.5, net: 4987.5 },
  )
  assert.deepEqual(salesAndRefunds(), { orders: 0, sales: 0, refundOrders: 0, refunds: 0, net: 0 })
})

test('a refund lands in its own month and leaves the sale month alone', () => {
  const buckets = mergeSalesAndRefunds(
    [
      { bucket: '2026-09', orders: 2, amount: '30.00' },
      { bucket: '2026-10', orders: 3, amount: '5000.00' },
    ],
    [{ bucket: '2026-10', orders: 1, amount: '12.50' }],
  )
  assert.deepEqual(buckets.get('2026-09'), { orders: 2, sales: 30, refundOrders: 0, refunds: 0, net: 30 })
  assert.deepEqual(buckets.get('2026-10'), { orders: 3, sales: 5000, refundOrders: 1, refunds: 12.5, net: 4987.5 })
})

test('a refund in a month with no sales still shows up', () => {
  const buckets = mergeSalesAndRefunds([], [{ bucket: '2026-11-02', orders: 1, amount: 8 }])
  assert.deepEqual(buckets.get('2026-11-02'), { orders: 0, sales: 0, refundOrders: 1, refunds: 8, net: -8 })
})

test('refund money is shown as a negative amount', () => {
  assert.equal(formatRefundMoney(12.5), '-$12.50')
  assert.equal(formatRefundMoney(1234.5), '-$1,234.50')
  assert.equal(formatRefundMoney(0), '$0.00')
  assert.equal(formatRefundMoney(undefined), '$0.00')
})
