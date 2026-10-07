const { resolveStockStatus } = require('./inventorySchema')
const { applyStockChange, roundStock, withTransaction, MAX_STOCK_QUANTITY } = require('./stockLedger')

const STOCK_UNITS = [
  { id: 'kg', singular: 'kg', section: 'uncountable' },
  { id: 'bags', singular: 'bag', section: 'countable' },
  { id: 'bottles', singular: 'bottle', section: 'countable' },
  { id: 'packs', singular: 'pack', section: 'countable' },
  { id: 'boxes', singular: 'box', section: 'countable' },
  { id: 'eggs', singular: 'egg', section: 'countable' },
  { id: 'coconuts', singular: 'coconut', section: 'countable' },
  { id: 'cans', singular: 'can', section: 'countable' },
  { id: 'tea bags', singular: 'tea bag', section: 'countable' },
]

function normalizeItemName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function collapseName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ')
}

function levenshtein(left, right) {
  const a = [...left]
  const b = [...right]
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
    }
  }
  return rows[a.length][b.length]
}

function reject(status, message, extra = {}) {
  const error = new Error(message)
  error.status = status
  Object.assign(error, extra)
  return error
}

function nameTokens(name) {
  return normalizeItemName(name)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .map((token) => (token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token))
}

function nearInventoryNames(existing, typed) {
  const match = matchInventoryName(existing, typed)
  if (!match.key || match.exact.length) return []
  const wanted = nameTokens(typed)
  const found = []
  for (const item of existing || []) {
    if (normalizeItemName(item.item_name) === match.key) continue
    const distance = levenshtein(match.key, normalizeItemName(item.item_name))
    const theirs = nameTokens(item.item_name)
    const shorter = wanted.length <= theirs.length ? wanted : theirs
    const longer = new Set(wanted.length <= theirs.length ? theirs : wanted)
    const subset = shorter.length > 0 && shorter.every((token) => longer.has(token))
    if ((distance > 0 && distance <= 2) || subset) {
      found.push({ id: item.id, item_name: item.item_name, distance, subset })
    }
  }
  found.sort((a, b) => a.distance - b.distance || a.id - b.id)
  return found
}

function closestNames(existing, typed, limit = 5) {
  const key = normalizeItemName(typed)
  return (existing || [])
    .map((item) => {
      const name = item.name || item.item_name
      return { name, distance: levenshtein(key, normalizeItemName(name)) }
    })
    .filter((item) => item.distance > 0)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function matchInventoryName(existing, typed) {
  const key = normalizeItemName(typed)
  const exact = (existing || []).filter((item) => normalizeItemName(item.item_name) === key)
  if (!key || exact.length) return { key, exact, suggestions: [] }
  const suggestions = []
  for (const item of existing || []) {
    const distance = levenshtein(key, normalizeItemName(item.item_name))
    if (distance > 0 && distance <= 2) suggestions.push({ ...item, distance })
  }
  suggestions.sort((a, b) => a.distance - b.distance || a.id - b.id)
  return { key, exact, suggestions: suggestions.slice(0, 3) }
}

function parseItemInput(body, { editing = false } = {}) {
  const itemName = collapseName(body?.item_name)
  const category = collapseName(body?.category)
  const section = body?.section === 'uncountable' ? 'uncountable' : body?.section === 'countable' ? 'countable' : ''
  const unit = STOCK_UNITS.find((entry) => entry.id === body?.unit_label)
  const maxStock = roundStock(body?.max_stock)
  const low = roundStock(body?.low_threshold)
  const criticalGiven = body?.critical_threshold !== '' && body?.critical_threshold != null
  const critical = criticalGiven ? roundStock(body.critical_threshold) : null
  const stock = editing ? null : roundStock(body?.stock_quantity)

  if (!itemName) throw reject(400, 'Item name is required', { code: 'validation' })
  if (itemName.length > 100) throw reject(400, 'Item name is too long', { code: 'validation' })
  if (!category) throw reject(400, 'Category is required', { code: 'validation' })
  if (category.length > 50) throw reject(400, 'Category is too long', { code: 'validation' })
  if (!section || !unit || unit.section !== section) {
    throw reject(400, 'Choose a table and a unit from the list', { code: 'validation' })
  }
  if (maxStock == null || maxStock < 0 || low == null || low < 0 || (criticalGiven && (critical == null || critical < 0))) {
    throw reject(400, 'Counts and thresholds must be zero or greater', { code: 'validation' })
  }
  if (!editing && (stock == null || stock < 0 || critical == null)) {
    throw reject(400, 'Counts and thresholds must be zero or greater', { code: 'validation' })
  }
  if ([maxStock, low, critical, stock].some((n) => n != null && n > MAX_STOCK_QUANTITY)) {
    throw reject(400, 'Counts and thresholds cannot be more than 1,000,000', { code: 'validation' })
  }
  if (maxStock < low || (critical != null && maxStock < critical)) {
    throw reject(400, 'Maximum must be at least the low and very-low thresholds', { code: 'validation' })
  }

  return {
    item_name: itemName,
    category,
    section,
    unit_label: unit.id,
    unit_singular: unit.singular,
    is_weight: section === 'uncountable' ? 1 : 0,
    max_stock: maxStock,
    low_threshold: low,
    critical_threshold: critical,
    stock_quantity: stock,
  }
}

async function loadNames(conn, exceptId = null) {
  const [rows] = await conn.execute(
    'SELECT id, item_name, section, unit_label, stock_quantity, max_stock FROM inventory',
  )
  return rows.filter((row) => Number(row.id) !== Number(exceptId))
}

function assertNameAvailable(existing, itemName, { allowSimilar = false } = {}) {
  const match = matchInventoryName(existing, itemName)
  if (match.exact.length) {
    throw reject(409, `${match.exact[0].item_name} is already in stock`, {
      code: 'duplicate',
      item: match.exact[0],
    })
  }
  if (!allowSimilar && match.suggestions.length) {
    throw reject(409, `Did you mean: ${match.suggestions[0].item_name}?`, {
      code: 'similar',
      suggestions: match.suggestions.map(({ id, item_name }) => ({ id, item_name })),
    })
  }
}

async function saveNewInventoryItem(conn, body, userId, options = {}) {
  const value = parseItemInput(body)
  const existing = await loadNames(conn)
  assertNameAvailable(existing, value.item_name, options)
  const status = resolveStockStatus(value.stock_quantity, value.low_threshold, value.critical_threshold)
  const [result] = await conn.execute(
    `INSERT INTO inventory (
       item_name, category, section, stock_quantity, max_stock,
       unit_label, unit_singular, low_threshold, critical_threshold,
       is_weight, stock_status, unit_cost
     ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      value.item_name,
      value.category,
      value.section,
      value.max_stock,
      value.unit_label,
      value.unit_singular,
      value.low_threshold,
      value.critical_threshold,
      value.is_weight,
      status,
    ],
  )
  if (value.stock_quantity > 0) {
    await applyStockChange(conn, {
      inventoryId: result.insertId,
      change: value.stock_quantity,
      reason: 'adjustment',
      note: 'Initial count',
      userId,
    })
  }
  const [rows] = await conn.execute('SELECT * FROM inventory WHERE id = ?', [result.insertId])
  return rows[0]
}

async function updateInventoryItem(conn, itemId, body, options = {}) {
  const value = parseItemInput(body, { editing: true })
  const [currentRows] = await conn.execute('SELECT * FROM inventory WHERE id = ? FOR UPDATE', [itemId])
  if (!currentRows.length) throw reject(404, 'Inventory item not found', { code: 'missing' })
  const current = currentRows[0]
  const existing = await loadNames(conn, itemId)
  assertNameAvailable(existing, value.item_name, { allowSimilar: true })

  const unitChanged = value.unit_label !== current.unit_label
  if (unitChanged && !options.confirmUnitChange) {
    const [links] = await conn.execute(
      'SELECT COUNT(*) AS n FROM menu_item_stock_links WHERE inventory_id = ?',
      [itemId],
    )
    const [moves] = await conn.execute(
      'SELECT COUNT(*) AS n FROM stock_movements WHERE inventory_id = ?',
      [itemId],
    )
    if (Number(links[0].n) > 0 || Number(moves[0].n) > 0) {
      throw reject(409, 'This item has recipe links or stock history. Old movements stay in the previous unit.', {
        code: 'unit_change',
      })
    }
  }

  const status = resolveStockStatus(Number(current.stock_quantity), value.low_threshold, value.critical_threshold)
  await conn.execute(
    `UPDATE inventory
     SET item_name = ?, category = ?, section = ?, max_stock = ?,
         unit_label = ?, unit_singular = ?, low_threshold = ?, critical_threshold = ?,
         is_weight = ?, stock_status = ?
     WHERE id = ?`,
    [
      value.item_name,
      value.category,
      value.section,
      value.max_stock,
      value.unit_label,
      value.unit_singular,
      value.low_threshold,
      value.critical_threshold,
      value.is_weight,
      status,
      itemId,
    ],
  )
  const [rows] = await conn.execute('SELECT * FROM inventory WHERE id = ?', [itemId])
  return rows[0]
}

function createInventoryItem(db, body, userId, options) {
  return withTransaction(db, (conn) => saveNewInventoryItem(conn, body, userId, options))
}

function editInventoryItem(db, itemId, body, options) {
  return withTransaction(db, (conn) => updateInventoryItem(conn, itemId, body, options))
}

module.exports = {
  STOCK_UNITS,
  normalizeItemName,
  matchInventoryName,
  nearInventoryNames,
  closestNames,
  parseItemInput,
  saveNewInventoryItem,
  updateInventoryItem,
  createInventoryItem,
  editInventoryItem,
}
