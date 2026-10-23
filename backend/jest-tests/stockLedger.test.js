const { roundStock, ADJUST_REASONS, MAX_STOCK_QUANTITY } = require('../src/utils/stockLedger')

describe('roundStock', () => {
  test('rounds to 6 decimal places', () => {
    expect(roundStock(0.1 + 0.2)).toBe(0.3)
    expect(roundStock(1.23456789)).toBe(1.234568)
  })

  test('a 9 g deduction from 1 kg leaves 0.991 kg', () => {
    expect(roundStock(1 - 0.009)).toBe(0.991)
  })

  test('accepts numeric strings', () => {
    expect(roundStock('2.5')).toBe(2.5)
  })

  test('returns null for values that are not numbers', () => {
    expect(roundStock('abc')).toBeNull()
    expect(roundStock(Infinity)).toBeNull()
    expect(roundStock(NaN)).toBeNull()
  })
})

describe('stock constants', () => {
  test('waste and correction are the allowed adjust reasons', () => {
    expect(ADJUST_REASONS).toEqual({ waste: 'waste', correction: 'adjustment' })
  })

  test('maximum stock quantity is one million', () => {
    expect(MAX_STOCK_QUANTITY).toBe(1000000)
  })
})
