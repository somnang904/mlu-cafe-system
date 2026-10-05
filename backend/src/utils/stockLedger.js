const { resolveStockStatus } = require('./inventorySchema')
const { clearAlertsCache } = require('./alertEngine')

const ADJUST_REASONS = {
  waste: 'waste',
  correction: 'adjustment',
}

function roundStock(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.round((num + Number.EPSILON) * 1e6) / 1e6
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function planStockDeltas(lines, links, takenByInventory) {
  const linksByMenu = new Map()
  for (const link of links || []) {
    const menuId = Number(link.menu_item_id)
    const inventoryId = Number(link.inventory_id)
    const perUnit = Number(link.quantity_per_unit)
    if (!Number.isInteger(menuId) || menuId <= 0) continue
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) continue
    if (!Number.isFinite(perUnit) || perUnit <= 0) continue
    const list = linksByMenu.get(menuId) || []
    list.push({ inventoryId, perUnit })
    linksByMenu.set(menuId, list)
  }

  const desired = new Map()
  for (const line of lines || []) {
    const menuId = Number(line.menu_item_id ?? line.menuItemId)
    const qty = Number(line.quantity)
    if (!Number.isInteger(menuId) || menuId <= 0 || !Number.isFinite(qty) || qty <= 0) continue
    for (const link of linksByMenu.get(menuId) || []) {
      const next = (desired.get(link.inventoryId) || 0) + qty * link.perUnit
      desired.set(link.inventoryId, roundStock(next))
    }
  }

  const ids = new Set([...desired.keys(), ...(takenByInventory?.keys() || [])])
  const deltas = []
  for (const inventoryId of [...ids].sort((a, b) => a - b)) {
    const want = desired.get(inventoryId) || 0
    const taken = roundStock(takenByInventory?.get(inventoryId) || 0) || 0
    const delta = roundStock(want - taken)
    if (delta !== 0) deltas.push({ inventoryId, delta })
  }
  return deltas
}

async function applyStockChange(conn, { inventoryId, change, reason, orderId = null, userId = null, note = null }) {
  const amount = roundStock(change)
  if (amount == null || amount === 0) {
    throw httpError(400, 'Stock change must be a non-zero number')
  }

  const [rows] = await conn.execute(
    `SELECT stock_quantity, low_threshold, critical_threshold, item_name, unit_label
     FROM inventory WHERE id = ? FOR UPDATE`,
    [inventoryId],
  )
  if (!rows.length) throw httpError(404, 'Inventory item not found')

  const current = Number(rows[0].stock_quantity)
  const next = roundStock(current + amount)
  const critical = rows[0].critical_threshold != null ? Number(rows[0].critical_threshold) : null
  const status = resolveStockStatus(next, Number(rows[0].low_threshold ?? 0), critical)

  await conn.execute(
    'UPDATE inventory SET stock_quantity = ?, stock_status = ? WHERE id = ?',
    [next, status, inventoryId],
  )
  await conn.execute(
    `INSERT INTO stock_movements
      (inventory_id, change_amount, quantity_after, reason, order_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inventoryId, amount, next, reason, orderId, note, userId],
  )

  return {
    inventoryId,
    quantity: next,
    change: amount,
    status,
    itemName: rows[0].item_name,
    unit: rows[0].unit_label || 'units',
    isCritical: status === 'OUT_OF_STOCK' || (critical != null && next <= critical) || next <= 0,
  }
}

async function loadDirectLinks(conn, menuIds) {
  if (!menuIds.length) return []
  const placeholders = menuIds.map(() => '?').join(', ')
  const [rows] = await conn.execute(
    `SELECT menu_item_id, inventory_id, quantity_per_unit
     FROM menu_item_stock_links
     WHERE variant = '' AND option_key = '' AND option_value = ''
       AND menu_item_id IN (${placeholders})`,
    menuIds,
  )
  return rows
}

async function loadNetTaken(conn, orderId) {
  const [rows] = await conn.execute(
    `SELECT inventory_id, COALESCE(SUM(-change_amount), 0) AS taken
     FROM stock_movements
     WHERE order_id = ? AND reason IN ('sale', 'cancel')
     GROUP BY inventory_id`,
    [orderId],
  )
  const taken = new Map()
  for (const row of rows) taken.set(Number(row.inventory_id), Number(row.taken))
  return taken
}

async function reconcileOrderStock(conn, orderId, lines, userId) {
  const [locked] = await conn.execute('SELECT id FROM orders WHERE id = ? FOR UPDATE', [orderId])
  if (!locked.length) throw httpError(404, 'Order not found')

  const menuIds = [...new Set(
    (lines || [])
      .map((line) => Number(line.menu_item_id ?? line.menuItemId))
      .filter((id) => Number.isInteger(id) && id > 0),
  )]
  const links = await loadDirectLinks(conn, menuIds)
  const taken = await loadNetTaken(conn, orderId)
  const deltas = planStockDeltas(lines, links, taken)

  const lowStockWarnings = []
  for (const entry of deltas) {
    const result = await applyStockChange(conn, {
      inventoryId: entry.inventoryId,
      change: roundStock(-entry.delta),
      reason: entry.delta > 0 ? 'sale' : 'cancel',
      orderId,
      userId,
    })
    if (result && (result.status === 'LOW_STOCK' || result.status === 'OUT_OF_STOCK' || result.isCritical)) {
      lowStockWarnings.push(result)
    }
  }

  return { deltas, lowStockWarnings }
}

async function addReceivedStock(conn, { inventoryId, quantity, userId }) {
  const qty = roundStock(quantity)
  if (qty == null || qty <= 0) throw httpError(400, 'Enter the quantity received')
  return applyStockChange(conn, {
    inventoryId,
    change: qty,
    reason: 'restock',
    userId,
  })
}

async function adjustStockToCount(conn, { inventoryId, quantity, reason, note, userId }) {
  const movementReason = ADJUST_REASONS[reason]
  if (!movementReason) throw httpError(400, 'Choose a reason: waste or correction')
  const trimmed = String(note || '').trim()
  if (!trimmed) throw httpError(400, 'A note is required')
  if (trimmed.length > 255) throw httpError(400, 'Note must be 255 characters or less')

  const exact = roundStock(quantity)
  if (exact == null) throw httpError(400, 'Enter the exact count on hand')

  const [rows] = await conn.execute(
    'SELECT stock_quantity FROM inventory WHERE id = ? FOR UPDATE',
    [inventoryId],
  )
  if (!rows.length) throw httpError(404, 'Inventory item not found')

  const change = roundStock(exact - Number(rows[0].stock_quantity))
  if (change === 0) throw httpError(400, 'That is already the count on hand')

  return applyStockChange(conn, {
    inventoryId,
    change,
    reason: movementReason,
    userId,
    note: trimmed,
  })
}

const LOCK_WAIT_SECONDS = 10

async function withTransaction(pool, work, { locks = [] } = {}) {
  const conn = await pool.getConnection()
  const held = []
  try {
    for (const name of [...new Set(locks)].sort()) {
      const [rows] = await conn.query(
        "SELECT GET_LOCK(CONCAT(DATABASE(), ':', ?), ?) AS ok",
        [name, LOCK_WAIT_SECONDS],
      )
      if (Number(rows[0]?.ok) !== 1) {
        throw httpError(409, 'Another device is updating this table. Please try again.')
      }
      held.push(name)
    }

    await conn.beginTransaction()
    const result = await work(conn)
    await conn.commit()
    clearAlertsCache()
    return result
  } catch (error) {
    try {
      await conn.rollback()
    } catch {
      // The original error is the one to report.
    }
    throw error
  } finally {
    let lockStuck = false
    for (const name of held.reverse()) {
      try {
        await conn.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':', ?))", [name])
      } catch {
        lockStuck = true
      }
    }
    if (lockStuck && typeof conn.destroy === 'function') conn.destroy()
    else conn.release()
  }
}

module.exports = {
  ADJUST_REASONS,
  roundStock,
  planStockDeltas,
  applyStockChange,
  reconcileOrderStock,
  addReceivedStock,
  adjustStockToCount,
  withTransaction,
}
