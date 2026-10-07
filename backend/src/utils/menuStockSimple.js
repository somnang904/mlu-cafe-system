const { resolveStockStatus } = require('./inventorySchema')
const { roundStock, applyStockChange, addReceivedStock, adjustStockToCount, MAX_STOCK_QUANTITY } = require('./stockLedger')

const DEFAULT_UNIT_LABEL = 'portions'
const DEFAULT_LOW_THRESHOLD = 5
const MIN_MAX_STOCK = 50
const MAX_UNIT_LABEL = 20
const NAME_SUFFIX = ' (stock)'
const MAX_INVENTORY_NAME = 100
const ACTIVE_ROWS_SQL = 'archived_at IS NULL OR is_ingredient = 1'

function httpError(status, message, code = null) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function classifyDirectItemRows(links) {
  const byInventory = new Map()
  for (const link of links || []) {
    const inventoryId = Number(link.inventory_id)
    if (!Number.isInteger(inventoryId) || inventoryId <= 0) continue
    const entry = byInventory.get(inventoryId) || { direct: 0, allOne: true, menuIds: new Set() }
    const isDirect = !link.variant && !link.option_key && !link.option_value
    if (isDirect) entry.direct += 1
    if (Number(link.quantity_per_unit) !== 1) entry.allOne = false
    entry.menuIds.add(Number(link.menu_item_id))
    byInventory.set(inventoryId, entry)
  }
  const keep = new Set()
  for (const [inventoryId, entry] of byInventory) {
    if (entry.direct > 0 && entry.allOne && entry.menuIds.size === 1) keep.add(inventoryId)
  }
  return keep
}

function rowsToArchive(activeIds, keepIds) {
  return (activeIds || []).map(Number).filter((id) => !keepIds.has(id))
}

function deriveSingular(label) {
  const text = String(label || '').trim()
  if (/ies$/i.test(text) && text.length > 3) return `${text.slice(0, -3)}y`
  if (/s$/i.test(text) && !/ss$/i.test(text) && text.length > 1) return text.slice(0, -1)
  return text
}

function uniqueInventoryName(baseName, existingNames) {
  const taken = new Set((existingNames || []).map((name) => String(name).trim().toLowerCase()))
  let candidate = String(baseName).trim()
  while (taken.has(candidate.toLowerCase())) candidate += NAME_SUFFIX
  return candidate
}

function tombstoneName(name, id) {
  const suffix = ` [removed ${id}]`
  const base = String(name || '').trim()
  if (base.endsWith(suffix)) return base
  return `${base.slice(0, MAX_INVENTORY_NAME - suffix.length)}${suffix}`
}

async function tombstoneInventoryRows(conn, ids) {
  for (const id of ids) {
    const [rows] = await conn.execute('SELECT item_name FROM inventory WHERE id = ? LIMIT 1', [id])
    if (!rows.length) continue
    await conn.execute('UPDATE inventory SET item_name = ? WHERE id = ?', [tombstoneName(rows[0].item_name, id), id])
  }
}

async function loadActiveInventoryNames(conn) {
  const [rows] = await conn.execute(`SELECT id, item_name FROM inventory WHERE ${ACTIVE_ROWS_SQL}`)
  return rows
}

function parseUnitLabel(value) {
  if (typeof value !== 'string') throw httpError(400, 'Unit must be text')
  const label = value.trim()
  if (!label) throw httpError(400, 'Unit cannot be empty')
  if (label.length > MAX_UNIT_LABEL) throw httpError(400, `Unit must be ${MAX_UNIT_LABEL} characters or less`)
  return label
}

function parsePackSize(value) {
  if (value === null) return null
  const size = Number(value)
  if (typeof value === 'boolean' || value === '' || !Number.isInteger(size) || size < 2) {
    throw httpError(400, 'Pack size must be a whole number of 2 or more')
  }
  return size
}

function parseLowThreshold(value) {
  const num = Number(value)
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(num) || num < 0) {
    throw httpError(400, 'Low stock level must be zero or more')
  }
  if (num > MAX_STOCK_QUANTITY) throw httpError(400, `Low stock level cannot be more than ${MAX_STOCK_QUANTITY.toLocaleString('en-US')}`)
  return roundStock(num)
}

function parseQuantity(value) {
  const num = Number(value)
  if (typeof value === 'boolean' || value === null || value === undefined || value === '' || !Number.isFinite(num) || num < 0) {
    throw httpError(400, 'Quantity must be zero or more')
  }
  if (num > MAX_STOCK_QUANTITY) throw httpError(400, `Quantity cannot be more than ${MAX_STOCK_QUANTITY.toLocaleString('en-US')}`)
  return roundStock(num)
}

function parseTrackBody(body) {
  const input = body || {}
  const quantity = parseQuantity(input.quantity)
  const unitLabel = input.unit_label === undefined ? DEFAULT_UNIT_LABEL : parseUnitLabel(input.unit_label)
  const packSize = input.pack_size === undefined ? null : parsePackSize(input.pack_size)
  const low = input.low_threshold === undefined ? DEFAULT_LOW_THRESHOLD : parseLowThreshold(input.low_threshold)
  return {
    quantity,
    unit_label: unitLabel,
    unit_singular: deriveSingular(unitLabel),
    pack_size: packSize,
    low_threshold: low,
    max_stock: Math.max(quantity, MIN_MAX_STOCK),
  }
}

function parseSettingsBody(body) {
  const input = body || {}
  const changes = {}
  if (input.unit_label !== undefined) {
    const label = parseUnitLabel(input.unit_label)
    changes.unit_label = label
    changes.unit_singular = deriveSingular(label)
  }
  if (input.pack_size !== undefined) changes.pack_size = parsePackSize(input.pack_size)
  if (input.low_threshold !== undefined) changes.low_threshold = parseLowThreshold(input.low_threshold)
  if (!Object.keys(changes).length) throw httpError(400, 'Nothing to change')
  return changes
}

function resolveRestock(body, row) {
  const input = body || {}
  const mode = input.mode
  if (mode !== 'set' && mode !== 'add' && mode !== 'remove') throw httpError(400, 'Choose set, add or remove')
  if (mode === 'set') {
    return { mode, quantity: parseQuantity(input.quantity) }
  }
  if (mode === 'remove') {
    const quantity = parseQuantity(input.quantity)
    if (quantity <= 0) throw httpError(400, 'Quantity to remove must be greater than zero')
    const reason = input.reason === 'waste' || input.reason === 'mistake' ? input.reason : null
    if (!reason) throw httpError(400, 'Choose a reason: entered by mistake, or spoiled or wasted', 'invalid_reason')
    const onHand = Number(row?.stock_quantity)
    if (Number.isFinite(onHand) && quantity > onHand) {
      throw httpError(400, 'You cannot remove more than the amount on hand', 'exceeds_stock')
    }
    return { mode, quantity, reason }
  }
  const hasPacks = input.packs !== undefined && input.packs !== null
  if (hasPacks) {
    const packs = Number(input.packs)
    if (typeof input.packs === 'boolean' || input.packs === '' || !Number.isFinite(packs) || packs <= 0) {
      throw httpError(400, 'Packs must be greater than zero')
    }
    if (packs > MAX_STOCK_QUANTITY) throw httpError(400, `Packs cannot be more than ${MAX_STOCK_QUANTITY.toLocaleString('en-US')}`)
    const size = Number(row?.pack_size)
    if (!Number.isInteger(size) || size < 2) {
      throw httpError(400, 'Set a pack size for this item first', 'no_pack_size')
    }
    return { mode, quantity: roundStock(packs * size) }
  }
  const quantity = parseQuantity(input.quantity)
  if (quantity <= 0) throw httpError(400, 'Quantity to add must be greater than zero')
  return { mode, quantity }
}

function serializeMenuStockRow(menu, stock) {
  const isAvailable = !(menu.is_available === 0 || menu.is_available === false)
  const base = {
    menu_item_id: Number(menu.id ?? menu.menu_item_id),
    name: menu.name,
    category: menu.category,
    image_url: menu.image_url ?? null,
    is_available: isAvailable,
    stock_unlimited: Number(menu.stock_unlimited) === 1,
  }
  if (!stock) {
    return {
      ...base,
      tracked: false,
      inventory_id: null,
      stock_quantity: null,
      unit_label: null,
      unit_singular: null,
      pack_size: null,
      low_threshold: null,
      stock_status: null,
    }
  }
  const quantity = Number(stock.stock_quantity)
  const low = stock.low_threshold != null ? Number(stock.low_threshold) : null
  return {
    ...base,
    tracked: true,
    inventory_id: Number(stock.id),
    stock_quantity: quantity,
    unit_label: stock.unit_label || null,
    unit_singular: stock.unit_singular || null,
    pack_size: stock.pack_size != null ? Number(stock.pack_size) : null,
    low_threshold: low,
    stock_status: resolveStockStatus(quantity, low, null),
  }
}

function summarizeMenuStockItems(items) {
  const tracked = items.filter((item) => item.tracked)
  return {
    total: items.length,
    tracked: tracked.length,
    untracked: items.length - tracked.length,
    low: tracked.filter((item) => item.stock_status === 'LOW_STOCK').length,
    out: tracked.filter((item) => item.stock_status === 'OUT_OF_STOCK').length,
  }
}

async function loadTrackedRows(conn, menuItemId = null, { lock = false } = {}) {
  const filter = menuItemId != null ? 'AND l.menu_item_id = ?' : ''
  const [rows] = await conn.execute(
    `SELECT l.id AS link_id, l.menu_item_id, i.*
     FROM menu_item_stock_links l
     JOIN inventory i ON i.id = l.inventory_id
     WHERE l.variant = '' AND l.option_key = '' AND l.option_value = ''
       AND l.quantity_per_unit = 1 AND i.archived_at IS NULL ${filter}
     ORDER BY l.id${lock ? ' FOR UPDATE' : ''}`,
    menuItemId != null ? [menuItemId] : [],
  )
  const byMenu = new Map()
  for (const row of rows) {
    const menuId = Number(row.menu_item_id)
    if (!byMenu.has(menuId)) byMenu.set(menuId, row)
  }
  return byMenu
}

async function listMenuStock(db) {
  const [menus] = await db.execute(
    'SELECT id, name, category, image_url, is_available, stock_unlimited FROM menu_items ORDER BY category, name',
  )
  const tracked = await loadTrackedRows(db)
  const items = menus.map((menu) => serializeMenuStockRow(menu, tracked.get(Number(menu.id))))
  return { items, summary: summarizeMenuStockItems(items) }
}

async function loadMenuStockItem(conn, menuItemId) {
  const [menus] = await conn.execute(
    'SELECT id, name, category, image_url, is_available, stock_unlimited FROM menu_items WHERE id = ? LIMIT 1',
    [menuItemId],
  )
  if (!menus.length) return null
  const tracked = await loadTrackedRows(conn, menuItemId)
  return serializeMenuStockRow(menus[0], tracked.get(Number(menuItemId)))
}

async function requireMenuItem(conn, menuItemId) {
  const [menus] = await conn.execute('SELECT id, name FROM menu_items WHERE id = ? LIMIT 1 FOR UPDATE', [menuItemId])
  if (!menus.length) throw httpError(404, 'Menu item not found')
  return menus[0]
}

async function requireTracked(conn, menuItemId) {
  const tracked = (await loadTrackedRows(conn, menuItemId, { lock: true })).get(Number(menuItemId))
  if (!tracked) throw httpError(409, 'This item does not have a stock count', 'not_tracked')
  return tracked
}

async function trackMenuItem(conn, menuItemId, body, userId) {
  const menu = await requireMenuItem(conn, menuItemId)
  const existing = await loadTrackedRows(conn, menuItemId, { lock: true })
  if (existing.has(Number(menuItemId))) throw httpError(409, 'This item already has a stock count', 'already_tracked')

  const value = parseTrackBody(body)
  const names = await loadActiveInventoryNames(conn)
  const itemName = uniqueInventoryName(menu.name, names.map((row) => row.item_name))
  const status = resolveStockStatus(0, value.low_threshold, null)
  const [result] = await conn.execute(
    `INSERT INTO inventory (
       item_name, category, section, stock_quantity, max_stock,
       unit_label, unit_singular, low_threshold, critical_threshold,
       is_weight, stock_status, unit_cost, pack_size
     ) VALUES (?, 'Menu', 'countable', 0, ?, ?, ?, ?, NULL, 0, ?, 0, ?)`,
    [itemName, value.max_stock, value.unit_label, value.unit_singular, value.low_threshold, status, value.pack_size],
  )
  await conn.execute(
    `INSERT INTO menu_item_stock_links
      (menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit)
     VALUES (?, '', '', '', ?, 1)`,
    [menuItemId, result.insertId],
  )
  if (value.quantity > 0) {
    await applyStockChange(conn, {
      inventoryId: result.insertId,
      change: value.quantity,
      reason: 'adjustment',
      note: 'Initial count',
      userId,
    })
  }
  return { inventoryId: result.insertId, itemName, quantity: value.quantity }
}

async function restockMenuItem(conn, menuItemId, body, userId) {
  await requireMenuItem(conn, menuItemId)
  const tracked = await requireTracked(conn, menuItemId)
  const plan = resolveRestock(body, tracked)
  const before = Number(tracked.stock_quantity)
  let after = before
  if (plan.mode === 'add') {
    const result = await addReceivedStock(conn, { inventoryId: tracked.id, quantity: plan.quantity, userId })
    after = result.quantity
  } else if (plan.mode === 'remove') {
    const result = await applyStockChange(conn, {
      inventoryId: tracked.id,
      change: -plan.quantity,
      reason: plan.reason === 'waste' ? 'waste' : 'adjustment',
      note: plan.reason === 'waste' ? 'Removed: spoiled or wasted' : 'Removed: entered by mistake',
      userId,
    })
    after = result.quantity
  } else if (roundStock(plan.quantity) !== roundStock(before)) {
    const result = await adjustStockToCount(conn, {
      inventoryId: tracked.id,
      quantity: plan.quantity,
      reason: 'correction',
      note: 'Restock: set amount',
      userId,
    })
    after = result.quantity
  }
  return { mode: plan.mode, inventoryId: Number(tracked.id), before, after }
}

async function updateMenuStockSettings(conn, menuItemId, body) {
  await requireMenuItem(conn, menuItemId)
  const tracked = await requireTracked(conn, menuItemId)
  const changes = parseSettingsBody(body)
  const next = {
    unit_label: changes.unit_label ?? tracked.unit_label,
    unit_singular: changes.unit_singular ?? tracked.unit_singular,
    pack_size: changes.pack_size !== undefined ? changes.pack_size : tracked.pack_size,
    low_threshold: changes.low_threshold ?? tracked.low_threshold,
  }
  const status = resolveStockStatus(Number(tracked.stock_quantity), Number(next.low_threshold), null)
  await conn.execute(
    `UPDATE inventory
     SET unit_label = ?, unit_singular = ?, pack_size = ?, low_threshold = ?, critical_threshold = NULL, stock_status = ?
     WHERE id = ?`,
    [next.unit_label, next.unit_singular, next.pack_size ?? null, next.low_threshold, status, tracked.id],
  )
  return { inventoryId: Number(tracked.id) }
}

async function untrackMenuItem(conn, menuItemId) {
  await requireMenuItem(conn, menuItemId)
  const tracked = await requireTracked(conn, menuItemId)
  await conn.execute(
    `DELETE FROM menu_item_stock_links
     WHERE menu_item_id = ? AND inventory_id = ?
       AND variant = '' AND option_key = '' AND option_value = ''`,
    [menuItemId, tracked.id],
  )
  await conn.execute('UPDATE inventory SET archived_at = NOW() WHERE id = ? AND archived_at IS NULL', [tracked.id])
  await tombstoneInventoryRows(conn, [Number(tracked.id)])
  return { inventoryId: Number(tracked.id), itemName: tracked.item_name }
}

async function syncTrackedStockName(conn, menuItemId, menuName) {
  const tracked = (await loadTrackedRows(conn, menuItemId, { lock: true })).get(Number(menuItemId))
  if (!tracked) return null
  const names = (await loadActiveInventoryNames(conn)).filter((row) => Number(row.id) !== Number(tracked.id))
  const itemName = uniqueInventoryName(menuName, names.map((row) => row.item_name)).slice(0, MAX_INVENTORY_NAME)
  if (itemName !== tracked.item_name) {
    await conn.execute('UPDATE inventory SET item_name = ? WHERE id = ?', [itemName, tracked.id])
  }
  return itemName
}

async function archiveInventoryOnlyLinkedTo(conn, menuItemId) {
  const [rows] = await conn.execute(
    `SELECT l.inventory_id
     FROM menu_item_stock_links l
     JOIN inventory i ON i.id = l.inventory_id
     WHERE l.menu_item_id = ? AND l.quantity_per_unit = 1 AND i.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM menu_item_stock_links o
         WHERE o.inventory_id = l.inventory_id AND o.menu_item_id <> l.menu_item_id
       )`,
    [menuItemId],
  )
  const ids = [...new Set(rows.map((row) => Number(row.inventory_id)))]
  if (!ids.length) return 0
  const [result] = await conn.execute(
    `UPDATE inventory SET archived_at = NOW() WHERE archived_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
    ids,
  )
  await tombstoneInventoryRows(conn, ids)
  return Number(result.affectedRows)
}

async function archiveNonDirectInventory(db) {
  const [links] = await db.execute(
    'SELECT menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit FROM menu_item_stock_links',
  )
  const keep = classifyDirectItemRows(links)
  const [active] = await db.execute('SELECT id FROM inventory WHERE archived_at IS NULL')
  const ids = rowsToArchive(active.map((row) => row.id), keep)
  let archived = 0
  for (let start = 0; start < ids.length; start += 200) {
    const chunk = ids.slice(start, start + 200)
    const [result] = await db.execute(
      `UPDATE inventory SET archived_at = NOW() WHERE archived_at IS NULL AND id IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    )
    archived += Number(result.affectedRows)
    await db.execute(
      `UPDATE inventory SET is_ingredient = 1
       WHERE category <> 'Menu' AND is_ingredient = 0 AND archived_at IS NOT NULL
         AND id IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    )
  }
  console.log(`   Simple stock: archived ${archived} inventory row${archived === 1 ? '' : 's'}, kept ${active.length - ids.length}`)
  return archived
}

module.exports = {
  DEFAULT_UNIT_LABEL,
  DEFAULT_LOW_THRESHOLD,
  classifyDirectItemRows,
  rowsToArchive,
  deriveSingular,
  uniqueInventoryName,
  tombstoneName,
  tombstoneInventoryRows,
  loadActiveInventoryNames,
  parseTrackBody,
  parseSettingsBody,
  resolveRestock,
  serializeMenuStockRow,
  summarizeMenuStockItems,
  listMenuStock,
  loadMenuStockItem,
  trackMenuItem,
  restockMenuItem,
  updateMenuStockSettings,
  untrackMenuItem,
  syncTrackedStockName,
  archiveInventoryOnlyLinkedTo,
  archiveNonDirectInventory,
}
