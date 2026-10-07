const test = require('node:test')
const assert = require('node:assert/strict')
const db = require('../db')
const { roundStock } = require('../src/utils/stockLedger')
const { applyStocktake, isLargeChange, parseAmount, stocktakeNote } = require('../src/utils/stocktake')

const egg = { item_name: 'Chicken Eggs', unit_label: 'eggs', is_weight: 0 }
const kilo = { item_name: 'Fresh Garlic', unit_label: 'kg', is_weight: 1 }
const condensed = { item_name: 'Condensed Milk', unit_label: 'cans', is_weight: 0 }

test('stocktake rejects letters, negatives, and fractional whole units', () => {
  assert.throws(() => parseAmount('abc', egg, 'counted quantity'), /number/)
  assert.throws(() => parseAmount('-1', egg, 'counted quantity'), /number/)
  assert.throws(() => parseAmount('1.5', egg, 'counted quantity'), /whole number/)
  assert.equal(parseAmount('1.25', kilo, 'counted quantity'), 1.25)
  assert.equal(parseAmount('13.333333', condensed, 'counted quantity'), 13.333333)
  assert.equal(parseAmount('', kilo, 'counted quantity'), null)
  assert.equal(isLargeChange(10, 16), true)
  assert.equal(isLargeChange(10, 15), false)
})

test('stocktake writes one movement per changed count and leaves blanks alone', async () => {
  const note = stocktakeNote()
  const conn = await db.getConnection()
  let changedIds = []
  const snapshots = new Map()
  try {
    await conn.beginTransaction()
    const [picked] = await conn.execute(
      `SELECT id, item_name, unit_label, stock_quantity, max_stock, stock_status
       FROM inventory
       WHERE item_name IN ('Fresh Garlic', 'Chicken Eggs', 'Soda Water (can)', 'Coffee Beans')
       ORDER BY item_name
       FOR UPDATE`,
    )
    assert.equal(picked.length, 4)
    await conn.execute(`UPDATE inventory SET archived_at = NULL WHERE id IN (${picked.map(() => '?').join(',')})`, picked.map((row) => row.id))
    const byName = new Map(picked.map((row) => [row.item_name, row]))
    const garlic = byName.get('Fresh Garlic')
    const eggs = byName.get('Chicken Eggs')
    const soda = byName.get('Soda Water (can)')
    const beans = byName.get('Coffee Beans')
    for (const row of picked) snapshots.set(row.id, { ...row })

    const beansBefore = roundStock(beans.stock_quantity)
    const sixty = roundStock(beansBefore * 1.6)
    await assert.rejects(
      () => applyStocktake(conn, {
        rows: [{ id: beans.id, counted: String(sixty), max: '' }],
        confirmLarge: false,
        userId: null,
        note,
      }),
      (error) => error.status === 409 && error.code === 'large_change' && error.rows[0].name === 'Coffee Beans',
    )
    const [beansStill] = await conn.execute('SELECT stock_quantity FROM inventory WHERE id = ?', [beans.id])
    assert.equal(roundStock(beansStill[0].stock_quantity), beansBefore)

    const garlicBefore = roundStock(garlic.stock_quantity)
    const eggsBefore = roundStock(eggs.stock_quantity)
    const sodaBefore = roundStock(soda.stock_quantity)
    const garlicNext = roundStock(garlicBefore + 0.25)
    const eggsNext = eggsBefore + 1
    const sodaNext = sodaBefore + 1
    assert.equal(isLargeChange(garlicBefore, garlicNext), false)
    assert.equal(isLargeChange(eggsBefore, eggsNext), false)
    assert.equal(isLargeChange(sodaBefore, sodaNext), false)
    const result = await applyStocktake(conn, {
      rows: [
        { id: garlic.id, counted: String(garlicNext), max: '' },
        { id: eggs.id, counted: String(eggsNext), max: '' },
        { id: soda.id, counted: String(sodaNext), max: '' },
      ],
      confirmLarge: false,
      userId: null,
      note,
    })
    assert.equal(result.changed.length, 3)
    assert.ok(result.blank >= 1)
    changedIds = result.changed.map((row) => row.id)

    const [moves] = await conn.execute(
      `SELECT inventory_id, reason, note, change_amount, user_id
       FROM stock_movements
       WHERE note = ? AND inventory_id IN (?, ?, ?, ?)`,
      [note, garlic.id, eggs.id, soda.id, beans.id],
    )
    const moved = new Set(moves.map((row) => Number(row.inventory_id)))
    assert.equal(moved.has(Number(garlic.id)), true)
    assert.equal(moved.has(Number(eggs.id)), true)
    assert.equal(moved.has(Number(soda.id)), true)
    assert.equal(moved.has(Number(beans.id)), false)
    for (const move of moves) {
      assert.equal(move.reason, 'adjustment')
      assert.equal(move.note, note)
    }

    const [quantities] = await conn.execute(
      `SELECT id, stock_quantity, stock_status FROM inventory WHERE id IN (?, ?, ?)`,
      [garlic.id, eggs.id, soda.id],
    )
    const after = new Map(quantities.map((row) => [Number(row.id), row]))
    assert.equal(roundStock(after.get(Number(garlic.id)).stock_quantity), garlicNext)
    assert.equal(roundStock(after.get(Number(eggs.id)).stock_quantity), eggsNext)
    assert.equal(roundStock(after.get(Number(soda.id)).stock_quantity), sodaNext)
    for (const row of quantities) assert.ok(row.stock_status)
  } finally {
    await conn.rollback()
    conn.release()
    if (changedIds.length) {
      const [left] = await db.execute(
        `SELECT COUNT(*) AS total FROM stock_movements WHERE note = ? AND inventory_id IN (${changedIds.map(() => '?').join(',')})`,
        [note, ...changedIds],
      )
      assert.equal(Number(left[0].total), 0)
    }
    for (const snap of snapshots.values()) {
      const [now] = await db.execute('SELECT stock_quantity FROM inventory WHERE id = ?', [snap.id])
      assert.equal(roundStock(now[0].stock_quantity), roundStock(snap.stock_quantity))
    }
  }
})

test.after(async () => {
  await db.end()
})
