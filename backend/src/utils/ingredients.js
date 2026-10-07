const { resolveStockStatus } = require('./inventorySchema')
const { roundStock, applyStockChange, addReceivedStock, adjustStockToCount } = require('./stockLedger')
const { deriveSingular } = require('./menuStockSimple')

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
  return roundStock(num)
}

function findDuplicateName(name, existing, ignoreId = null) {
  const wanted = String(name).trim().toLowerCase()
  return (existing || []).some((row) => {
    if (ignoreId != null && Number(row.id) === Number(ignoreId)) return false
    return String(row.item_name).trim().toLowerCase() === wanted
  })
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
  if (!Object.keys(changes).length) throw httpError(400, 'Nothing to change')
  return changes
}

function resolveAdjust(body, row) {
  const input = body || {}
  const mode = input.mode
  if (mode !== 'add' && mode !== 'remove' && mode !== 'count') throw httpError(400, 'Choose add, remove or count')
  const quantity = parseAmount(input.quantity, 'Quantity')
  if (mode === 'count') return { mode, quantity }
  if (quantity <= 0) throw httpError(400, `Quantity to ${mode} must be greater than zero`)
  if (mode === 'add') return { mode, quantity }
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
  const items = rows.map(serializeIngredient)
  return { items, summary: summarizeIngredients(items) }
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
  const [names] = await conn.execute('SELECT id, item_name FROM inventory')
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
    const [names] = await conn.execute('SELECT id, item_name FROM inventory')
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
  }
  const status = resolveStockStatus(Number(row.stock_quantity), Number(next.low_threshold), null)
  await conn.execute(
    `UPDATE inventory
     SET item_name = ?, category = ?, unit_label = ?, unit_singular = ?, low_threshold = ?,
         critical_threshold = NULL, stock_status = ?
     WHERE id = ?`,
    [next.item_name, next.category, next.unit_label, next.unit_singular, next.low_threshold, status, id],
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
  return { inventoryId: Number(row.id), itemName: row.item_name }
}

module.exports = {
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
