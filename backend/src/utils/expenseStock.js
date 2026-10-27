const { roundStock, applyStockChange, MAX_STOCK_QUANTITY } = require('./stockLedger')
const { createIngredient } = require('./ingredients')
const { columnExists } = require('./ordersSchema')

// Items bought with an expense ("Buy vegetables" = garlic 1 kg + chili 0.5 kg). Each line adds its
// quantity to the item's stock; editing the expense moves the stock by the difference and deleting
// it takes the quantity back out, so stock always matches what the expenses say was bought.
// A line can also carry what that item cost (dollars), which becomes the item's latest unit cost.
const MAX_LINES = 30
const MAX_COST = 1_000_000_000

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, field: 'items' })
}

async function ensureExpenseStockSchema(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS expense_stock_lines (
      id INT AUTO_INCREMENT PRIMARY KEY,
      expense_id INT NOT NULL,
      inventory_id INT NOT NULL,
      quantity DECIMAL(14, 6) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_expense_stock_expense (expense_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  if (!(await columnExists(db, 'expense_stock_lines', 'cost'))) {
    await db.execute('ALTER TABLE expense_stock_lines ADD COLUMN cost DECIMAL(12, 2) NULL AFTER quantity')
  }
}

/** The line's price in dollars, or null when it was left out. */
function parseCost(value) {
  if (value === undefined || value === null || value === '') return null
  const cost = Number(value)
  if (typeof value === 'boolean' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
    throw badRequest('Enter a price of zero or more for every item')
  }
  return Math.round(cost * 100) / 100
}

function addCost(a, b) {
  if (a == null) return b
  if (b == null) return a
  return Math.round((a + b) * 100) / 100
}

// Ingredients (kept out of the menu-stock list with archived_at) and active menu stock items.
const PURCHASABLE_WHERE = '(is_ingredient = 1 OR archived_at IS NULL)'

/** What can be bought with an expense, for the form's item picker. */
async function listPurchasableItems(db) {
  const [rows] = await db.execute(
    `SELECT id, item_name, category, unit_label, unit_singular, stock_quantity, is_ingredient
     FROM inventory WHERE ${PURCHASABLE_WHERE}
     ORDER BY is_ingredient DESC, item_name`,
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.item_name,
    category: row.category || '',
    unit: row.unit_label || '',
    unit_singular: row.unit_singular || row.unit_label || '',
    stock: Number(row.stock_quantity) || 0,
    kind: Number(row.is_ingredient) === 1 ? 'ingredient' : 'stock',
  }))
}

/**
 * `items` from the request: [{ inventory_id, quantity, cost? }] for an existing item, or
 * [{ new_name, unit, quantity, cost? }] for an ingredient bought for the first time.
 * Returns { existing: Map inventoryId -> quantity, costs: Map inventoryId -> cost, created: [...] };
 * the same item twice is added up.
 */
function parseStockLines(items) {
  if (!Array.isArray(items)) throw badRequest('items must be a list')
  if (items.length > MAX_LINES) throw badRequest(`Add ${MAX_LINES} items or fewer`)
  const existing = new Map()
  const costs = new Map()
  const created = []
  for (const item of items) {
    const quantity = Number(item?.quantity)
    if (typeof item?.quantity === 'boolean' || !Number.isFinite(quantity) || quantity <= 0) {
      throw badRequest('Enter a quantity greater than zero for every item')
    }
    if (quantity > MAX_STOCK_QUANTITY) {
      throw badRequest(`Quantity cannot be more than ${MAX_STOCK_QUANTITY.toLocaleString('en-US')}`)
    }
    const cost = parseCost(item?.cost)
    if (item?.new_name !== undefined) {
      const name = String(item.new_name ?? '').trim().replace(/\s+/g, ' ')
      const unit = String(item.unit ?? '').trim()
      if (!name || !unit) throw badRequest('Enter a name and a unit for the new ingredient')
      if (created.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
        throw badRequest(`${name} is listed twice`)
      }
      created.push({ name, unit, quantity: roundStock(quantity), cost })
      continue
    }
    const id = Number(item?.inventory_id)
    if (!Number.isInteger(id) || id <= 0) throw badRequest('Choose an item for every line')
    existing.set(id, roundStock((existing.get(id) || 0) + quantity))
    costs.set(id, costs.has(id) ? addCost(costs.get(id), cost) : cost)
  }
  return { existing, costs, created }
}

function hasStockLines(lines) {
  return Boolean(lines && (lines.existing.size || lines.created.length))
}

async function loadLines(conn, expenseId) {
  const [rows] = await conn.execute('SELECT inventory_id, quantity FROM expense_stock_lines WHERE expense_id = ?', [expenseId])
  const lines = new Map()
  for (const row of rows) lines.set(Number(row.inventory_id), roundStock(Number(row.quantity)))
  return lines
}

function movementNote(expenseId, label) {
  return `Expense #${expenseId}${label ? `: ${label}` : ''}`.slice(0, 255)
}

/**
 * Makes the expense's items the ones in `lines` (from parseStockLines), creating new ingredients
 * first, and moves stock by the difference from what it had before. Runs inside the caller's transaction.
 */
async function setExpenseStock(conn, expenseId, lines, { userId = null, label = '' } = {}) {
  const next = new Map(lines.existing)
  const costs = new Map(lines.costs)
  for (const item of lines.created) {
    try {
      const { inventoryId } = await createIngredient(conn, { name: item.name, unit_label: item.unit }, userId)
      next.set(inventoryId, roundStock((next.get(inventoryId) || 0) + item.quantity))
      costs.set(inventoryId, addCost(costs.get(inventoryId) ?? null, item.cost))
    } catch (error) {
      if (error.code === 'duplicate_name') throw badRequest(`${item.name} already exists - choose it from the list`)
      throw error
    }
  }
  const previous = await loadLines(conn, expenseId)
  const added = [...next.keys()].filter((id) => !previous.has(id))
  if (added.length) {
    const [rows] = await conn.execute(
      `SELECT id FROM inventory WHERE id IN (${added.map(() => '?').join(',')}) AND ${PURCHASABLE_WHERE}`,
      added,
    )
    if (rows.length !== added.length) throw badRequest('One of the items no longer exists')
  }

  const ids = [...new Set([...previous.keys(), ...next.keys()])].sort((a, b) => a - b)
  for (const inventoryId of ids) {
    const delta = roundStock((next.get(inventoryId) || 0) - (previous.get(inventoryId) || 0))
    if (!delta) continue
    await applyStockChange(conn, {
      inventoryId,
      change: delta,
      reason: delta > 0 ? 'restock' : 'adjustment',
      note: movementNote(expenseId, delta > 0 ? label : `${label ? `${label} - ` : ''}edited`),
      userId,
    })
  }

  await conn.execute('DELETE FROM expense_stock_lines WHERE expense_id = ?', [expenseId])
  for (const [inventoryId, quantity] of next) {
    const cost = costs.get(inventoryId) ?? null
    await conn.execute(
      'INSERT INTO expense_stock_lines (expense_id, inventory_id, quantity, cost) VALUES (?, ?, ?, ?)',
      [expenseId, inventoryId, quantity, cost],
    )
    // The latest price paid per unit (e.g. $4.50 for 30 eggs = $0.15 an egg).
    if (cost > 0) {
      await conn.execute('UPDATE inventory SET unit_cost = ? WHERE id = ?', [Math.round((cost / quantity) * 10000) / 10000, inventoryId])
    }
  }
}

/** Takes an expense's items back out of stock (the expense is being deleted). */
async function clearExpenseStock(conn, expenseId, { userId = null, label = '' } = {}) {
  const previous = await loadLines(conn, expenseId)
  for (const [inventoryId, quantity] of previous) {
    await applyStockChange(conn, {
      inventoryId,
      change: -quantity,
      reason: 'adjustment',
      note: movementNote(expenseId, `${label ? `${label} - ` : ''}deleted`),
      userId,
    })
  }
  await conn.execute('DELETE FROM expense_stock_lines WHERE expense_id = ?', [expenseId])
  return previous.size
}

/**
 * Names an ingredient purchase after what it bought ("Fresh Red Chili, Tofu, Fresh Garlic +2"),
 * for an expense saved without a title. Runs after setExpenseStock, so new ingredients have names.
 */
async function titleExpenseFromItems(conn, expenseId) {
  const [rows] = await conn.execute(
    `SELECT i.item_name FROM expense_stock_lines l JOIN inventory i ON i.id = l.inventory_id
     WHERE l.expense_id = ? ORDER BY l.id`,
    [expenseId],
  )
  const names = rows.map((row) => row.item_name).filter(Boolean)
  if (!names.length) return
  const shown = names.slice(0, 3).join(', ')
  const title = `${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}`.slice(0, 160)
  await conn.execute('UPDATE expenses SET title = ? WHERE id = ?', [title, expenseId])
}

async function hasExpenseStock(db, expenseId) {
  const [rows] = await db.execute('SELECT 1 FROM expense_stock_lines WHERE expense_id = ? LIMIT 1', [expenseId])
  return rows.length > 0
}

/** Map expenseId -> [{ inventory_id, name, unit, quantity, cost }] for the given expenses. */
async function loadExpenseItems(db, expenseIds) {
  const ids = [...new Set(expenseIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  const byExpense = new Map()
  if (!ids.length) return byExpense
  const [rows] = await db.execute(
    `SELECT l.expense_id, l.inventory_id, l.quantity, l.cost, i.item_name, i.unit_label
     FROM expense_stock_lines l
     LEFT JOIN inventory i ON i.id = l.inventory_id
     WHERE l.expense_id IN (${ids.map(() => '?').join(',')})
     ORDER BY l.id`,
    ids,
  )
  for (const row of rows) {
    const list = byExpense.get(Number(row.expense_id)) || []
    list.push({
      inventory_id: Number(row.inventory_id),
      name: row.item_name || '',
      unit: row.unit_label || '',
      quantity: roundStock(Number(row.quantity)),
      cost: row.cost == null ? null : Number(row.cost),
    })
    byExpense.set(Number(row.expense_id), list)
  }
  return byExpense
}

module.exports = {
  ensureExpenseStockSchema,
  listPurchasableItems,
  parseStockLines,
  hasStockLines,
  setExpenseStock,
  titleExpenseFromItems,
  clearExpenseStock,
  hasExpenseStock,
  loadExpenseItems,
}
