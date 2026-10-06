const test = require('node:test')
const assert = require('node:assert/strict')
const { billMatchesBase, combineDuplicateLines, pickLinePrices } = require('../src/utils/orderTargets')
const { planSplitCheckout } = require('../src/utils/splitCheckout')
const { planStockDeltas } = require('../src/utils/stockLedger')

function fakeOrderItems(rows) {
  const table = rows.map((row) => ({ ...row }))
  const db = {
    rows: table,
    async execute(sql, params) {
      if (sql.startsWith('SELECT')) {
        return [table.filter((row) => row.order_id === params[0]).sort((a, b) => a.id - b.id)]
      }
      if (sql.startsWith('UPDATE order_items SET quantity')) {
        const [quantity, subtotal, id] = params
        Object.assign(table.find((row) => row.id === id), { quantity, subtotal })
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('DELETE FROM order_items WHERE id IN')) {
        for (const id of params) table.splice(table.findIndex((row) => row.id === id), 1)
        return [{ affectedRows: params.length }]
      }
      throw new Error(`unexpected query ${sql}`)
    },
  }
  return db
}

const latte = (id, quantity, price, extra = {}) => ({
  id,
  order_id: 9,
  menu_item_id: 7,
  item_name: 'Latte',
  notes: 'Iced',
  quantity,
  price,
  subtotal: quantity * price,
  ...extra,
})

test('merged lines for the same item at the same price become one row', async () => {
  const db = fakeOrderItems([latte(1, 2, 2.5), latte(2, 1, 2.5), latte(3, 1, 2.5, { notes: 'Hot' })])
  const removed = await combineDuplicateLines(db, 9)
  assert.equal(removed, 1)
  assert.deepEqual(
    db.rows.map(({ id, notes, quantity, subtotal }) => ({ id, notes, quantity, subtotal })),
    [
      { id: 1, notes: 'Iced', quantity: 3, subtotal: 7.5 },
      { id: 3, notes: 'Hot', quantity: 1, subtotal: 2.5 },
    ],
  )
})

test('merged lines for the same item at different prices stay separate', async () => {
  const db = fakeOrderItems([latte(1, 2, 2.5), latte(2, 1, 2)])
  assert.equal(await combineDuplicateLines(db, 9), 0)
  assert.equal(db.rows.length, 2)
  const total = db.rows.reduce((sum, row) => sum + row.quantity * row.price, 0)
  assert.equal(total, 7)
})

test('combining lines leaves the stock that the order needs unchanged', async () => {
  const links = [{ menu_item_id: 7, inventory_id: 3, quantity_per_unit: 1 }]
  const db = fakeOrderItems([latte(1, 2, 2.5), latte(2, 1, 2.5), latte(3, 1, 2)])
  const before = planStockDeltas(db.rows, links, new Map())
  assert.ok(before.length > 0)
  await combineDuplicateLines(db, 9)
  assert.deepEqual(planStockDeltas(db.rows, links, new Map()), before)
})

test('custom lines combine by name and price, not with menu lines', async () => {
  const db = fakeOrderItems([
    latte(1, 1, 3, { menu_item_id: null, item_name: 'Cake', notes: null }),
    latte(2, 1, 3, { menu_item_id: null, item_name: 'cake', notes: '' }),
    latte(3, 1, 3, { menu_item_id: null, item_name: 'Pie', notes: null }),
  ])
  await combineDuplicateLines(db, 9)
  assert.deepEqual(db.rows.map((row) => [row.item_name, row.quantity]), [['Cake', 2], ['Pie', 1]])
})

test('a cashier keeps each saved price when one item is on the bill at two prices', async () => {
  const db = fakeOrderItems([latte(1, 2, 2.5), latte(2, 1, 2)])
  const prices = await pickLinePrices(db, 9, [
    { menu_item_id: 7, notes: 'Iced', quantity: 3, price: 2.5 },
    { menu_item_id: 7, notes: 'Iced', quantity: 1, price: 2 },
  ], { isAdmin: false })
  assert.deepEqual(prices, [2.5, 2])
})

test('a cashier cannot choose a price that is not saved on the bill', async () => {
  const single = fakeOrderItems([latte(1, 2, 2.5)])
  assert.deepEqual(
    await pickLinePrices(single, 9, [{ menu_item_id: 7, notes: 'Iced', quantity: 2, price: 0.5 }], { isAdmin: false }),
    [2.5],
  )
  const two = fakeOrderItems([latte(1, 2, 2.5), latte(2, 1, 2)])
  assert.deepEqual(
    await pickLinePrices(two, 9, [{ menu_item_id: 7, notes: 'Iced', quantity: 1, price: 0.5 }], { isAdmin: false }),
    [null],
  )
})

test('an admin price still wins', async () => {
  const db = fakeOrderItems([latte(1, 2, 2.5)])
  assert.deepEqual(
    await pickLinePrices(db, 9, [{ menu_item_id: 7, notes: 'Iced', quantity: 2, price: 1 }], { isAdmin: true }),
    [1],
  )
})

test('the bill conflict check counts both price lines of one item together', () => {
  const saved = [latte(1, 2, 2.5), latte(2, 1, 2)]
  assert.equal(billMatchesBase(saved, [{ menu_item_id: 7, notes: 'Iced', quantity: 3 }]), true)
  assert.equal(
    billMatchesBase(saved, [
      { menu_item_id: 7, notes: 'Iced', quantity: 2, price: 2.5 },
      { menu_item_id: 7, notes: 'Iced', quantity: 1, price: 2 },
    ]),
    true,
  )
})

test('a split takes the line with the selected price first', () => {
  const lines = [latte(1, 2, 2.5), latte(2, 1, 2)]
  const plan = planSplitCheckout(lines, [{ menu_item_id: 7, notes: 'Iced', qty: 1, unitPrice: 2 }])
  assert.equal(plan.splitTotal, 2)
  assert.deepEqual(plan.lineUpdates, [{ id: 2, quantity: 0 }])
})
