const test = require('node:test')
const assert = require('node:assert/strict')
const {
  findDuplicateName,
  parseCreateBody,
  parseUpdateBody,
  resolveAdjust,
  serializeIngredient,
  summarizeIngredients,
} = require('../src/utils/ingredients')

const fails = (fn, code, status = 400) => assert.throws(fn, (error) => error.status === status && (code === undefined || error.code === code))

test('create applies defaults and derives the singular unit', () => {
  const value = parseCreateBody({ name: '  Sugar ', unit_label: 'bags' })
  assert.equal(value.name, 'Sugar')
  assert.equal(value.category, 'Other')
  assert.equal(value.quantity, 0)
  assert.equal(value.low_threshold, 5)
  assert.equal(value.unit_singular, 'bag')
  assert.equal(value.max_stock, 50)
})

test('create keeps a large starting quantity as max stock', () => {
  assert.equal(parseCreateBody({ name: 'Rice', unit_label: 'kg', quantity: 120 }).max_stock, 120)
})

test('create rejects bad input', () => {
  fails(() => parseCreateBody({ unit_label: 'kg' }))
  fails(() => parseCreateBody({ name: '', unit_label: 'kg' }))
  fails(() => parseCreateBody({ name: 'x'.repeat(101), unit_label: 'kg' }))
  fails(() => parseCreateBody({ name: 'A' }))
  fails(() => parseCreateBody({ name: 'A', unit_label: 'x'.repeat(21) }))
  fails(() => parseCreateBody({ name: 'A', unit_label: 'kg', category: 'c'.repeat(51) }))
  fails(() => parseCreateBody({ name: 'A', unit_label: 'kg', quantity: -1 }))
  fails(() => parseCreateBody({ name: 'A', unit_label: 'kg', low_threshold: 'abc' }))
})

test('duplicate names ignore case and the row being edited', () => {
  const rows = [{ id: 1, item_name: 'Whole Milk' }, { id: 2, item_name: 'Sugar' }]
  assert.equal(findDuplicateName('whole milk', rows), true)
  assert.equal(findDuplicateName(' SUGAR ', rows), true)
  assert.equal(findDuplicateName('Sugar', rows, 2), false)
  assert.equal(findDuplicateName('Salt', rows), false)
})

test('update takes only the given fields and refuses an empty change', () => {
  assert.deepEqual(parseUpdateBody({ low_threshold: 3 }), { low_threshold: 3 })
  const changes = parseUpdateBody({ unit_label: 'bottles', name: 'Syrup' })
  assert.equal(changes.unit_singular, 'bottle')
  assert.equal(changes.name, 'Syrup')
  fails(() => parseUpdateBody({}))
  fails(() => parseUpdateBody({ name: '  ' }))
})

test('add needs a positive quantity', () => {
  assert.deepEqual(resolveAdjust({ mode: 'add', quantity: 2 }, { stock_quantity: 1 }), { mode: 'add', quantity: 2 })
  fails(() => resolveAdjust({ mode: 'add', quantity: 0 }, {}))
  fails(() => resolveAdjust({ mode: 'bogus', quantity: 1 }, {}))
})

test('remove needs a reason and cannot exceed the amount on hand', () => {
  const row = { stock_quantity: 4 }
  fails(() => resolveAdjust({ mode: 'remove', quantity: 1 }, row), 'invalid_reason')
  fails(() => resolveAdjust({ mode: 'remove', quantity: 1, reason: 'lost' }, row), 'invalid_reason')
  fails(() => resolveAdjust({ mode: 'remove', quantity: 5, reason: 'used' }, row), 'exceeds_stock')
  fails(() => resolveAdjust({ mode: 'remove', quantity: 0, reason: 'used' }, row))
})

test('remove maps the reason to a ledger reason and note', () => {
  const row = { stock_quantity: 4 }
  const used = resolveAdjust({ mode: 'remove', quantity: 1, reason: 'used' }, row)
  assert.equal(used.ledgerReason, 'adjustment')
  assert.equal(used.note, 'Removed: used')
  const waste = resolveAdjust({ mode: 'remove', quantity: 4, reason: 'waste' }, row)
  assert.equal(waste.ledgerReason, 'waste')
  assert.equal(waste.note, 'Removed: spoiled or wasted')
  const mistake = resolveAdjust({ mode: 'remove', quantity: 1, reason: 'mistake' }, row)
  assert.equal(mistake.note, 'Removed: entered by mistake')
  assert.equal(resolveAdjust({ mode: 'remove', quantity: 1, reason: 'used', note: ' for cake ' }, row).note, 'for cake')
  fails(() => resolveAdjust({ mode: 'remove', quantity: 1, reason: 'used', note: 'n'.repeat(256) }, row))
})

test('count accepts zero and rejects negatives', () => {
  assert.deepEqual(resolveAdjust({ mode: 'count', quantity: 0 }, { stock_quantity: 3 }), { mode: 'count', quantity: 0 })
  fails(() => resolveAdjust({ mode: 'count', quantity: -2 }, {}))
  fails(() => resolveAdjust({ mode: 'count' }, {}))
})

test('serialization gives numbers and a stock status', () => {
  const base = { id: '7', item_name: 'Milk', category: 'Dairy', unit_label: 'boxes', unit_singular: 'box', updated_at: null }
  const ok = serializeIngredient({ ...base, stock_quantity: '12.000000', low_threshold: '10.00', critical_threshold: null })
  assert.equal(ok.id, 7)
  assert.equal(ok.stock_quantity, 12)
  assert.equal(ok.low_threshold, 10)
  assert.equal(ok.stock_status, 'IN_STOCK')
  assert.equal(serializeIngredient({ ...base, stock_quantity: 3.82, low_threshold: 10 }).stock_status, 'LOW_STOCK')
  assert.equal(serializeIngredient({ ...base, stock_quantity: 0, low_threshold: 10 }).stock_status, 'OUT_OF_STOCK')
})

test('summary counts low and out items', () => {
  const summary = summarizeIngredients([
    { stock_status: 'IN_STOCK' }, { stock_status: 'LOW_STOCK' }, { stock_status: 'OUT_OF_STOCK' }, { stock_status: 'OUT_OF_STOCK' },
  ])
  assert.deepEqual(summary, { total: 4, low: 1, out: 2 })
})
