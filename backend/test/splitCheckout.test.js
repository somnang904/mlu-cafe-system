const test = require('node:test')
const assert = require('node:assert/strict')
const { planSplitCheckout } = require('../src/utils/splitCheckout')
const { planStockDeltas } = require('../src/utils/stockLedger')

const order = [
  { id: 1, menu_item_id: 125, item_name: null, quantity: 2, price: 1.5, notes: '' },
  { id: 2, menu_item_id: 7, item_name: null, quantity: 1, price: 2.5, notes: 'Iced' },
  { id: 3, menu_item_id: null, item_name: 'Birthday cake', quantity: 1, price: 12, notes: 'no candles' },
]

test('split total uses the saved line price, not the price the client sends', () => {
  const plan = planSplitCheckout(order, [{ menu_item_id: 125, qty: 1, unitPrice: 0 }])
  assert.equal(plan.splitTotal, 1.5)
  assert.deepEqual(plan.splitLines, [{ menu_item_id: 125, item_name: null, quantity: 1, price: 1.5, notes: '' }])
})

test('an item that is not on the order is refused', () => {
  assert.throws(() => planSplitCheckout(order, [{ menu_item_id: 999, qty: 1 }]), { status: 400 })
})

test('selecting more than was ordered is refused', () => {
  assert.throws(() => planSplitCheckout(order, [{ menu_item_id: 125, qty: 3 }]), { status: 400 })
})

test('the same notes are required, so a hot latte cannot pay for an iced one', () => {
  assert.throws(() => planSplitCheckout(order, [{ menu_item_id: 7, notes: 'Hot', qty: 1 }]), { status: 400 })
})

test('zero, negative and fractional quantities are refused', () => {
  for (const qty of [0, -1, 1.5]) {
    assert.throws(() => planSplitCheckout(order, [{ menu_item_id: 125, qty }]), { status: 400 })
  }
})

test('a custom line matches by its display name with notes appended', () => {
  const plan = planSplitCheckout(order, [{ menu_item_id: null, name: 'Birthday cake (no candles)', notes: 'no candles', qty: 1 }])
  assert.equal(plan.splitTotal, 12)
})

test('remaining lines and line updates reflect what was split off', () => {
  const plan = planSplitCheckout(order, [
    { menu_item_id: 125, qty: 1 },
    { menu_item_id: 7, notes: 'Iced', qty: 1 },
  ])
  assert.equal(plan.splitTotal, 4)
  assert.deepEqual(plan.lineUpdates, [
    { id: 1, quantity: 1 },
    { id: 2, quantity: 0 },
  ])
  assert.deepEqual(
    plan.remainingLines.map((line) => [line.id, line.quantity]),
    [[1, 1], [3, 1]],
  )
})

test('one request can draw from several saved lines of the same item', () => {
  const twoRows = [
    { id: 10, menu_item_id: 125, quantity: 1, price: 1.5, notes: '' },
    { id: 11, menu_item_id: 125, quantity: 2, price: 1.25, notes: '' },
  ]
  const plan = planSplitCheckout(twoRows, [{ menu_item_id: 125, qty: 2 }])
  assert.equal(plan.splitTotal, 2.75)
  assert.deepEqual(plan.lineUpdates, [
    { id: 10, quantity: 0 },
    { id: 11, quantity: 1 },
  ])
})

test('two requests for the same item cannot claim the same bottle twice', () => {
  assert.throws(
    () => planSplitCheckout(order, [{ menu_item_id: 125, qty: 2 }, { menu_item_id: 125, qty: 1 }]),
    { status: 400 },
  )
})

test('splitting the whole bill leaves stock deducted once, not twice', () => {
  const beer = { menu_item_id: 125, inventory_id: 12, quantity_per_unit: 1 }
  const sum = (deltas) => deltas.reduce((total, d) => total + d.delta, 0)

  const onSave = planStockDeltas([{ menu_item_id: 125, quantity: 2 }], [beer], new Map())
  assert.equal(sum(onSave), 2)

  const plan = planSplitCheckout(order, [{ menu_item_id: 125, qty: 2 }])
  const originalReturn = planStockDeltas(plan.remainingLines, [beer], new Map([[12, 2]]))
  const splitTake = planStockDeltas(plan.splitLines, [beer], new Map())

  assert.equal(sum(onSave) + sum(originalReturn) + sum(splitTake), 2)
})
