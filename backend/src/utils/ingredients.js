const { resolveStockStatus } = require('./inventorySchema')
const { roundStock, applyStockChange, addReceivedStock, adjustStockToCount, MAX_STOCK_QUANTITY } = require('./stockLedger')
const { deriveSingular, tombstoneInventoryRows, loadActiveInventoryNames } = require('./menuStockSimple')

const DEFAULT_CATEGORY = 'Other'
const DEFAULT_LOW_THRESHOLD = 5
const MIN_MAX_STOCK = 50
const MAX_NAME = 100
const MAX_CATEGORY = 50
const MAX_UNIT_LABEL = 20
const MAX_NOTE = 255

const REMOVE_NOTES = {
  used: 'Removed: used',
  waste: 'Removed: spoiled or wasted',
  mistake: 'Removed: entered by mistake',
}

function httpError(status, message, code = null) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function parseText(value, label, max) {
  if (typeof value !== 'string') throw httpError(400, `${label} must be text`)
  const text = value.trim()
  if (!text) throw httpError(400, `${label} cannot be empty`)
  if (text.length > max) throw httpError(400, `${label} must be ${max} characters or less`)
  return text
}

function parseAmount(value, label) {
  const num = Number(value)
  if (typeof value === 'boolean' || value === null || value === undefined || value === '' || !Number.isFinite(num) || num < 0) {
    throw httpError(400, `${label} must be zero or more`)
  }
  if (num > MAX_STOCK_QUANTITY) {
    throw httpError(400, `${label} cannot be more than ${MAX_STOCK_QUANTITY.toLocaleString('en-US')}`)
  }
  return roundStock(num)
}

function findDuplicateName(name, existing, ignoreId = null) {
  const wanted = String(name).trim().toLowerCase()
  return (existing || []).some((row) => {
    if (ignoreId != null && Number(row.id) === Number(ignoreId)) return false
    return String(row.item_name).trim().toLowerCase() === wanted
  })
}

const MAX_PURCHASE_SIZE = 1000000

function parsePurchase(input) {
  if (input.purchase_unit === undefined && input.purchase_size === undefined) return undefined
  const rawUnit = input.purchase_unit == null ? '' : String(input.purchase_unit).trim()
  const rawSize = input.purchase_size
  if (!rawUnit && (rawSize == null || rawSize === '')) return { purchase_unit: null, purchase_size: null }
  const unit = parseText(rawUnit, 'Purchase unit', MAX_UNIT_LABEL)
  const size = Number(rawSize)
  if (typeof rawSize === 'boolean' || !Number.isFinite(size) || size <= 0 || size > MAX_PURCHASE_SIZE) {
    throw httpError(400, 'Purchase size must be more than 0', 'invalid_purchase_size')
  }
  return { purchase_unit: unit, purchase_size: Math.round(size * 1e6) / 1e6 }
}

function parseCreateBody(body) {
  const input = body || {}
  const name = parseText(input.name, 'Name', MAX_NAME)
  const category = input.category === undefined ? DEFAULT_CATEGORY : parseText(input.category, 'Category', MAX_CATEGORY)
  const unitLabel = parseText(input.unit_label, 'Unit', MAX_UNIT_LABEL)
  const quantity = input.quantity === undefined ? 0 : parseAmount(input.quantity, 'Quantity')
  const low = input.low_threshold === undefined ? DEFAULT_LOW_THRESHOLD : parseAmount(input.low_threshold, 'Low stock level')
  return {
    name,
    category,
    unit_label: unitLabel,
    unit_singular: deriveSingular(unitLabel),
    quantity,
    low_threshold: low,
    max_stock: Math.max(quantity, MIN_MAX_STOCK),
    ...(parsePurchase(input) || { purchase_unit: null, purchase_size: null }),
  }
}

function parseUpdateBody(body) {
  const input = body || {}
  const changes = {}
  if (input.name !== undefined) changes.name = parseText(input.name, 'Name', MAX_NAME)
  if (input.category !== undefined) changes.category = parseText(input.category, 'Category', MAX_CATEGORY)
  if (input.unit_label !== undefined) {
    const label = parseText(input.unit_label, 'Unit', MAX_UNIT_LABEL)
    changes.unit_label = label
    changes.unit_singular = deriveSingular(label)
  }
  if (input.low_threshold !== undefined) changes.low_threshold = parseAmount(input.low_threshold, 'Low stock level')
  const purchase = parsePurchase(input)
  if (purchase) Object.assign(changes, purchase)
  if (!Object.keys(changes).length) throw httpError(400, 'Nothing to change')
  return changes
}

function resolveAdjust(body, row) {
  const input = body || {}
  const mode = input.mode
  if (mode !== 'add' && mode !== 'remove' && mode !== 'count') throw httpError(400, 'Choose add, remove or count')
  if (mode === 'add') {
    const base = input.quantity == null || input.quantity === '' ? 0 : parseAmount(input.quantity, 'Quantity')
    const packs = input.packs == null || input.packs === '' ? 0 : parseAmount(input.packs, 'Number of packs')
    const size = Number(row?.purchase_size)
    if (packs > 0 && !(size > 0)) throw httpError(400, 'Set a purchase unit size for this ingredient first', 'no_purchase_size')
    const total = roundStock(base + packs * (size > 0 ? size : 0))
    if (!(total > 0)) throw httpError(400, 'Quantity to add must be greater than zero')
    return { mode, quantity: total }
  }
  const quantity = parseAmount(input.quantity, 'Quantity')
  if (mode === 'count') return { mode, quantity }
  if (quantity <= 0) throw httpError(400, `Quantity to ${mode} must be greater than zero`)
  const reason = input.reason
  if (reason !== 'used' && reason !== 'waste' && reason !== 'mistake') {
    throw httpError(400, 'Choose a reason: used, spoiled or wasted, or entered by mistake', 'invalid_reason')
  }
  const onHand = Number(row?.stock_quantity)
  if (Number.isFinite(onHand) && quantity > onHand) {
    throw httpError(400, 'You cannot remove more than the amount on hand', 'exceeds_stock')
  }
  let note = REMOVE_NOTES[reason]
  if (input.note !== undefined && input.note !== null && String(input.note).trim()) {
    const custom = String(input.note).trim()
    if (custom.length > MAX_NOTE) throw httpError(400, `Note must be ${MAX_NOTE} characters or less`)
    note = custom
  }
  return { mode, quantity, reason, ledgerReason: reason === 'waste' ? 'waste' : 'adjustment', note }
}

function serializeIngredient(row) {
  const quantity = Number(row.stock_quantity)
  const low = row.low_threshold != null ? Number(row.low_threshold) : 0
  const critical = row.critical_threshold != null ? Number(row.critical_threshold) : null
  return {
    id: Number(row.id),
    item_name: row.item_name,
    category: row.category,
    unit_label: row.unit_label || null,
    unit_singular: row.unit_singular || null,
    stock_quantity: quantity,
    low_threshold: low,
    stock_status: resolveStockStatus(quantity, low, critical),
    purchase_unit: row.purchase_unit || null,
    purchase_size: row.purchase_size != null ? Number(row.purchase_size) : null,
    updated_at: row.updated_at ?? null,
  }
}

function summarizeIngredients(items) {
  return {
    total: items.length,
    low: items.filter((item) => item.stock_status === 'LOW_STOCK').length,
    out: items.filter((item) => item.stock_status === 'OUT_OF_STOCK').length,
  }
}

async function listIngredients(db) {
  const [rows] = await db.execute(
    'SELECT * FROM inventory WHERE is_ingredient = 1 ORDER BY category, item_name',
  )
  const [uses] = await db.execute(
    `SELECT l.inventory_id, l.quantity_per_unit, m.id AS menu_item_id, m.name
     FROM menu_item_stock_links l
     JOIN inventory i ON i.id = l.inventory_id AND i.is_ingredient = 1
     JOIN menu_items m ON m.id = l.menu_item_id
     WHERE l.variant = '' AND l.option_key = '' AND l.option_value = ''
     ORDER BY m.name`,
  )
  const usedIn = new Map()
  for (const use of uses) {
    const list = usedIn.get(Number(use.inventory_id)) || []
    list.push({ menu_item_id: Number(use.menu_item_id), name: use.name, quantity: Number(use.quantity_per_unit) })
    usedIn.set(Number(use.inventory_id), list)
  }
  const items = rows.map((row) => ({ ...serializeIngredient(row), used_in: usedIn.get(Number(row.id)) || [] }))
  return { items, summary: summarizeIngredients(items) }
}

const MAX_RECIPE_LINES = 30
const MAX_RECIPE_QUANTITY = 1000

function parseRecipeLines(body) {
  const lines = body?.lines
  if (!Array.isArray(lines)) throw httpError(400, 'lines must be a list')
  if (lines.length > MAX_RECIPE_LINES) throw httpError(400, `A recipe can have at most ${MAX_RECIPE_LINES} ingredients`)
  const seen = new Set()
  return lines.map((line) => {
    const ingredientId = Number(line?.ingredient_id)
    const quantity = Number(line?.quantity)
    if (!Number.isInteger(ingredientId) || ingredientId <= 0) throw httpError(400, 'Choose an ingredient for every line')
    if (typeof line?.quantity === 'boolean' || !Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_RECIPE_QUANTITY) {
      throw httpError(400, `Amount per serving must be more than 0 and at most ${MAX_RECIPE_QUANTITY}`)
    }
    if (seen.has(ingredientId)) throw httpError(400, 'Each ingredient can appear only once', 'duplicate_ingredient')
    seen.add(ingredientId)
    return { ingredient_id: ingredientId, quantity: Math.round(quantity * 1e6) / 1e6 }
  })
}

async function loadRecipe(conn, menuItemId) {
  const [menus] = await conn.execute('SELECT id, name FROM menu_items WHERE id = ? LIMIT 1', [menuItemId])
  if (!menus.length) throw httpError(404, 'Menu item not found')
  const [rows] = await conn.execute(
    `SELECT l.inventory_id, l.quantity_per_unit, i.item_name, i.unit_label, i.unit_singular, i.stock_quantity
     FROM menu_item_stock_links l
     JOIN inventory i ON i.id = l.inventory_id AND i.is_ingredient = 1
     WHERE l.menu_item_id = ? AND l.variant = '' AND l.option_key = '' AND l.option_value = ''
     ORDER BY i.item_name`,
    [menuItemId],
  )
  return {
    menu_item_id: Number(menus[0].id),
    name: menus[0].name,
    lines: rows.map((row) => ({
      ingredient_id: Number(row.inventory_id),
      item_name: row.item_name,
      unit_label: row.unit_label,
      unit_singular: row.unit_singular,
      stock_quantity: Number(row.stock_quantity),
      quantity: Number(row.quantity_per_unit),
    })),
  }
}

async function saveRecipe(conn, menuItemId, body) {
  const lines = parseRecipeLines(body)
  const [menus] = await conn.execute('SELECT id FROM menu_items WHERE id = ? LIMIT 1 FOR UPDATE', [menuItemId])
  if (!menus.length) throw httpError(404, 'Menu item not found')
  if (lines.length) {
    const ids = lines.map((line) => line.ingredient_id)
    const [found] = await conn.execute(
      `SELECT id FROM inventory WHERE is_ingredient = 1 AND id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    )
    if (found.length !== ids.length) throw httpError(400, 'One of the ingredients no longer exists', 'unknown_ingredient')
  }
  await conn.execute(
    `DELETE l FROM menu_item_stock_links l
     JOIN inventory i ON i.id = l.inventory_id AND i.is_ingredient = 1
     WHERE l.menu_item_id = ? AND l.variant = '' AND l.option_key = '' AND l.option_value = ''`,
    [menuItemId],
  )
  for (const line of lines) {
    await conn.execute(
      `INSERT INTO menu_item_stock_links (menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit)
       VALUES (?, '', '', '', ?, ?)`,
      [menuItemId, line.ingredient_id, line.quantity],
    )
  }
  return loadRecipe(conn, menuItemId)
}

async function loadIngredient(conn, id, { lock = false } = {}) {
  const [rows] = await conn.execute(
    `SELECT * FROM inventory WHERE id = ? AND is_ingredient = 1 LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows[0] || null
}

async function requireIngredient(conn, id, options) {
  const row = await loadIngredient(conn, id, options)
  if (!row) throw httpError(404, 'Ingredient not found')
  return row
}

async function createIngredient(conn, body, userId) {
  const value = parseCreateBody(body)
  const names = await loadActiveInventoryNames(conn)
  if (findDuplicateName(value.name, names)) {
    throw httpError(400, 'An item with this name already exists', 'duplicate_name')
  }
  const status = resolveStockStatus(0, value.low_threshold, null)
  const [result] = await conn.execute(
    `INSERT INTO inventory (
       item_name, category, section, stock_quantity, max_stock,
       unit_label, unit_singular, low_threshold, critical_threshold,
       is_weight, stock_status, unit_cost, archived_at, is_ingredient
     ) VALUES (?, ?, 'countable', 0, ?, ?, ?, ?, NULL, 0, ?, 0, NOW(), 1)`,
    [value.name, value.category, value.max_stock, value.unit_label, value.unit_singular, value.low_threshold, status],
  )
  if (value.purchase_unit) {
    await conn.execute('UPDATE inventory SET purchase_unit = ?, purchase_size = ? WHERE id = ?', [value.purchase_unit, value.purchase_size, result.insertId])
  }
  if (value.quantity > 0) {
    await applyStockChange(conn, {
      inventoryId: result.insertId,
      change: value.quantity,
      reason: 'adjustment',
      note: 'Initial count',
      userId,
    })
  }
  return { inventoryId: result.insertId, itemName: value.name, quantity: value.quantity }
}

async function updateIngredient(conn, id, body) {
  const row = await requireIngredient(conn, id, { lock: true })
  const changes = parseUpdateBody(body)
  if (changes.name !== undefined) {
    const names = await loadActiveInventoryNames(conn)
    if (findDuplicateName(changes.name, names, id)) {
      throw httpError(400, 'An item with this name already exists', 'duplicate_name')
    }
  }
  const next = {
    item_name: changes.name ?? row.item_name,
    category: changes.category ?? row.category,
    unit_label: changes.unit_label ?? row.unit_label,
    unit_singular: changes.unit_singular ?? row.unit_singular,
    low_threshold: changes.low_threshold ?? Number(row.low_threshold),
    purchase_unit: changes.purchase_unit !== undefined ? changes.purchase_unit : row.purchase_unit ?? null,
    purchase_size: changes.purchase_size !== undefined ? changes.purchase_size : row.purchase_size ?? null,
  }
  const status = resolveStockStatus(Number(row.stock_quantity), Number(next.low_threshold), null)
  await conn.execute(
    `UPDATE inventory
     SET item_name = ?, category = ?, unit_label = ?, unit_singular = ?, low_threshold = ?,
         critical_threshold = NULL, stock_status = ?, purchase_unit = ?, purchase_size = ?
     WHERE id = ?`,
    [next.item_name, next.category, next.unit_label, next.unit_singular, next.low_threshold, status, next.purchase_unit, next.purchase_size, id],
  )
  return { inventoryId: Number(id), itemName: next.item_name }
}

async function adjustIngredient(conn, id, body, userId) {
  const row = await requireIngredient(conn, id, { lock: true })
  const plan = resolveAdjust(body, row)
  const before = Number(row.stock_quantity)
  let after = before
  if (plan.mode === 'add') {
    after = (await addReceivedStock(conn, { inventoryId: row.id, quantity: plan.quantity, userId })).quantity
  } else if (plan.mode === 'remove') {
    after = (await applyStockChange(conn, {
      inventoryId: row.id,
      change: -plan.quantity,
      reason: plan.ledgerReason,
      note: plan.note,
      userId,
    })).quantity
  } else if (roundStock(plan.quantity) !== roundStock(before)) {
    after = (await adjustStockToCount(conn, {
      inventoryId: row.id,
      quantity: plan.quantity,
      reason: 'correction',
      note: 'Counted',
      userId,
    })).quantity
  }
  return { mode: plan.mode, inventoryId: Number(row.id), itemName: row.item_name, before, after }
}

async function removeIngredient(conn, id) {
  const row = await requireIngredient(conn, id, { lock: true })
  await conn.execute('UPDATE inventory SET is_ingredient = 0 WHERE id = ?', [id])
  await tombstoneInventoryRows(conn, [Number(row.id)])
  return { inventoryId: Number(row.id), itemName: row.item_name }
}

async function convertIngredient(conn, id, body) {
  const row = await requireIngredient(conn, id, { lock: true })
  const unit = parseText(body?.unit_label, 'New unit', MAX_UNIT_LABEL)
  const factor = Number(body?.factor)
  if (typeof body?.factor === 'boolean' || !Number.isFinite(factor) || factor <= 0 || factor > MAX_PURCHASE_SIZE) {
    throw httpError(400, 'Enter how many new units make one old unit', 'invalid_factor')
  }
  const next = roundStock(Number(row.stock_quantity) * factor)
  if (Math.abs(next) > MAX_PURCHASE_SIZE * 100) throw httpError(400, 'The converted amount is too large')
  const low = roundStock(Number(row.low_threshold || 0) * factor)
  await conn.execute(
    `UPDATE inventory
     SET stock_quantity = ?, low_threshold = ?, critical_threshold = NULL, max_stock = LEAST(max_stock * ?, 99999999),
         unit_label = ?, unit_singular = ?, purchase_unit = ?, purchase_size = ?, stock_status = ?
     WHERE id = ?`,
    [next, low, factor, unit, deriveSingular(unit), row.unit_label || null, factor, resolveStockStatus(next, low, null), id],
  )
  await conn.execute(
    'UPDATE menu_item_stock_links SET quantity_per_unit = ROUND(quantity_per_unit * ?, 6) WHERE inventory_id = ?',
    [factor, id],
  )
  return { inventoryId: Number(id), itemName: row.item_name, from: row.unit_label, to: unit, factor }
}

module.exports = {
  convertIngredient,
  parseRecipeLines,
  loadRecipe,
  saveRecipe,
  DEFAULT_CATEGORY,
  DEFAULT_LOW_THRESHOLD,
  findDuplicateName,
  parseCreateBody,
  parseUpdateBody,
  resolveAdjust,
  serializeIngredient,
  summarizeIngredients,
  listIngredients,
  loadIngredient,
  createIngredient,
  updateIngredient,
  adjustIngredient,
  removeIngredient,
}
