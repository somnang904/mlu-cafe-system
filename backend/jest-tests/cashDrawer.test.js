const {
  DEFAULT_EXCHANGE_RATE,
  assertPaymentAmounts,
  splitChange,
  cashDrawerDelta,
  summarizeCashOrders,
  computeCashDifference,
} = require('../src/utils/cashDrawer')

describe('splitChange (change given in USD + riel)', () => {
  test('whole dollars have no riel part', () => {
    expect(splitChange(3, 4000)).toEqual({ usd: 3, khr: 0 })
  })

  test('$0.25 at 4000 riel/USD is 1,000 riel', () => {
    expect(splitChange(0.25, 4000)).toEqual({ usd: 0, khr: 1000 })
  })

  test('$2.50 at 4100 riel/USD is $2 and 2,100 riel (rounded to 100)', () => {
    expect(splitChange(2.5, 4100)).toEqual({ usd: 2, khr: 2100 })
  })

  test('negative change is treated as zero', () => {
    expect(splitChange(-5)).toEqual({ usd: 0, khr: 0 })
  })

  test('falls back to the default rate when the rate is invalid', () => {
    expect(splitChange(0.5, 0)).toEqual(splitChange(0.5, DEFAULT_EXCHANGE_RATE))
  })
})

describe('cashDrawerDelta (cash kept in the drawer per order)', () => {
  test('paid $20 for a $10 order keeps $10', () => {
    expect(cashDrawerDelta({ total: 10, received_usd: 20 })).toEqual({ usd: 10, khr: 0 })
  })

  test('paid 20,000 riel for a $5 order at 4000 keeps 20,000 riel and no dollars', () => {
    const order = { total: 5, received_khr: 20000, exchange_rate: 4000 }
    expect(cashDrawerDelta(order)).toEqual({ usd: 0, khr: 20000 })
  })

  test('an order with no received amount counts its total in USD', () => {
    expect(cashDrawerDelta({ total: 7.5 })).toEqual({ usd: 7.5, khr: 0 })
  })
})

describe('summarizeCashOrders', () => {
  test('adds sales and drawer totals across orders', () => {
    const orders = [
      { total: 10, received_usd: 20 },
      { total: 5, received_khr: 20000, exchange_rate: 4000 },
    ]
    expect(summarizeCashOrders(orders)).toEqual({
      salesUsd: 15,
      netUsd: 10,
      netKhr: 20000,
      exchangeRate: 4000,
    })
  })

  test('no orders gives zero totals and the default rate', () => {
    expect(summarizeCashOrders([])).toEqual({
      salesUsd: 0,
      netUsd: 0,
      netKhr: 0,
      exchangeRate: DEFAULT_EXCHANGE_RATE,
    })
  })
})

describe('computeCashDifference (counted vs expected cash)', () => {
  const expected = { expectedUsd: 100, expectedKhr: 40000, exchangeRate: 4000 }

  test('$2 short in USD', () => {
    expect(computeCashDifference({ ...expected, countedUsd: 98, countedKhr: 40000 }))
      .toEqual({ usd: -2, khr: 0, totalUsd: -2 })
  })

  test('4,000 riel short equals $1 short at 4000 riel/USD', () => {
    expect(computeCashDifference({ ...expected, countedUsd: 100, countedKhr: 36000 }))
      .toEqual({ usd: 0, khr: -4000, totalUsd: -1 })
  })

  test('matching counts give no difference', () => {
    expect(computeCashDifference({ ...expected, countedUsd: 100, countedKhr: 40000 }))
      .toEqual({ usd: 0, khr: 0, totalUsd: 0 })
  })
})

describe('assertPaymentAmounts (checkout input check)', () => {
  test('accepts numbers, numeric strings and missing amounts', () => {
    expect(() => assertPaymentAmounts({ receivedUsd: 10, receivedKhr: '40000', changeUsd: null })).not.toThrow()
  })

  test('rejects SQL-looking text in received_usd', () => {
    expect(() => assertPaymentAmounts({ receivedUsd: '10 AND 1=1 -- ' })).toThrow('received_usd must be a number')
  })

  test('rejects negative amounts', () => {
    expect(() => assertPaymentAmounts({ receivedKhr: -100 })).toThrow('received_khr cannot be negative')
  })
})
