import {
  parseMenuItemId,
  calculateTotals,
  buildOrderSummary,
  mergeCartIntoItems,
  normalizeBillItem,
  applyItemsToBill,
  formatInvoiceId,
} from '../src/utils/posHelpers'

describe('POS menu item id', () => {
  test('accepts positive whole numbers and numeric strings', () => {
    expect(parseMenuItemId(125)).toBe(125)
    expect(parseMenuItemId('130')).toBe(130)
  })

  test('rejects zero, negatives, decimals and text', () => {
    expect(parseMenuItemId(0)).toBeNull()
    expect(parseMenuItemId(-3)).toBeNull()
    expect(parseMenuItemId(1.5)).toBeNull()
    expect(parseMenuItemId('12abc')).toBeNull()
    expect(parseMenuItemId(null)).toBeNull()
  })
})

describe('POS bill totals', () => {
  test('sums the line totals of every item on the bill', () => {
    const items = [{ lineTotal: 2.5 }, { lineTotal: 3.5 }]
    expect(calculateTotals(items)).toEqual({ subtotal: 6, tax: 0, total: 6 })
  })

  test('an empty bill totals zero', () => {
    expect(calculateTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })

  test('a line total is quantity times unit price', () => {
    const line = normalizeBillItem({ id: 7, name: 'Iced Latte', qty: '3', price: '2.5' })
    expect(line.qty).toBe(3)
    expect(line.unitPrice).toBe(2.5)
    expect(line.lineTotal).toBe(7.5)
  })
})

describe('POS cart merging', () => {
  const latte = { id: 7, name: 'Latte', price: 2.5, qty: 1 }

  test('adding a new item puts it on the bill with its line total', () => {
    const merged = mergeCartIntoItems([], [{ ...latte, qty: 2 }])
    expect(merged).toHaveLength(1)
    expect(merged[0].qty).toBe(2)
    expect(merged[0].lineTotal).toBe(5)
  })

  test('adding the same item again increases its quantity and total', () => {
    const first = mergeCartIntoItems([], [{ ...latte, qty: 2 }])
    const second = mergeCartIntoItems(first, [{ ...latte, qty: 1 }])
    expect(second).toHaveLength(1)
    expect(second[0].qty).toBe(3)
    expect(second[0].lineTotal).toBe(7.5)
  })

  test('the same item with different notes stays on a separate line', () => {
    const first = mergeCartIntoItems([], [{ ...latte, notes: 'Less sugar' }])
    const second = mergeCartIntoItems(first, [{ ...latte, notes: 'No ice' }])
    expect(second).toHaveLength(2)
  })

  test('merging does not change the original bill', () => {
    const first = mergeCartIntoItems([], [latte])
    mergeCartIntoItems(first, [latte])
    expect(first[0].qty).toBe(1)
  })
})

describe('POS bill state', () => {
  test('a bill with items is occupied and shows the order total and summary', () => {
    const bill = applyItemsToBill({ id: 1 }, [
      { id: 7, name: 'Latte', qty: 2, price: 2.5 },
      { id: 9, name: 'Cake', qty: 1, price: 3 },
    ])
    expect(bill.status).toBe('occupied')
    expect(bill.orderTotal).toBe(8)
    expect(bill.orderSummary).toBe('2× Latte, 1× Cake')
  })

  test('removing every item makes the table empty again', () => {
    const bill = applyItemsToBill({ id: 1, status: 'occupied' }, [])
    expect(bill.status).toBe('empty')
    expect(bill.orderTotal).toBeNull()
    expect(bill.items).toEqual([])
  })

  test('order summary joins quantity and name', () => {
    expect(buildOrderSummary([{ qty: 3, name: 'Tiger Crystal' }])).toBe('3× Tiger Crystal')
  })

  test('invoice numbers use the INV- prefix', () => {
    expect(formatInvoiceId(42)).toBe('INV-42')
  })
})
