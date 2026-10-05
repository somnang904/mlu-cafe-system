const test = require('node:test')
const assert = require('node:assert/strict')
const { summarizeMenuStock } = require('../src/utils/menuStock')

test('a bottle item shows how many bottles are left', () => {
  const summary = summarizeMenuStock([
    { menu_item_id: 125, quantity_per_unit: 1, stock_quantity: 9, stock_status: 'IN_STOCK' },
  ])
  assert.deepEqual(summary.get(125), { stock_left: 9, stock_status: 'IN_STOCK' })
})

test('the scarcest ingredient decides how many cups are left', () => {
  const summary = summarizeMenuStock([
    { menu_item_id: 7, quantity_per_unit: 0.018, stock_quantity: 1, stock_status: 'IN_STOCK' },
    { menu_item_id: 7, quantity_per_unit: 0.15, stock_quantity: 0.9, stock_status: 'LOW_STOCK' },
  ])
  assert.deepEqual(summary.get(7), { stock_left: 6, stock_status: 'LOW_STOCK' })
})

test('less than one portion on hand is out of stock', () => {
  const summary = summarizeMenuStock([
    { menu_item_id: 3, quantity_per_unit: 0.2, stock_quantity: 0.15, stock_status: 'LOW_STOCK' },
  ])
  assert.deepEqual(summary.get(3), { stock_left: 0, stock_status: 'OUT_OF_STOCK' })
})

test('exact divisions are not rounded down by floating point error', () => {
  const summary = summarizeMenuStock([
    { menu_item_id: 4, quantity_per_unit: 0.1, stock_quantity: 0.3, stock_status: 'IN_STOCK' },
  ])
  assert.equal(summary.get(4).stock_left, 3)
})

test('negative stock counts as none left', () => {
  const summary = summarizeMenuStock([
    { menu_item_id: 5, quantity_per_unit: 1, stock_quantity: -2, stock_status: 'OUT_OF_STOCK' },
  ])
  assert.deepEqual(summary.get(5), { stock_left: 0, stock_status: 'OUT_OF_STOCK' })
})

test('items without stock links are not in the summary', () => {
  const summary = summarizeMenuStock([])
  assert.equal(summary.get(99), undefined)
})
