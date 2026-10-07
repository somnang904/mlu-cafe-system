const { resolveStockStatus } = require('./inventorySchema')
const { applyStockChange, roundStock } = require('./stockLedger')

const WHOLE_UNITS = new Set([
  'bottles',
  'bottle',
  'cans',
  'can',
  'eggs',
  'egg',
  'coconuts',
  'coconut',
  'tea bags',
  'tea bag',
])

function stocktakeNote(date = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return `Opening stocktake ${day}`
}

function allowsDecimal(item) {
  if (Number(item.is_weight) === 1) return true
  const unit = String(item.unit_label || '').trim().toLowerCase()
  // Cans may be fractional (open condensed-milk can, etc.).
  if (unit === 'cans' || unit === 'can') return true
  return !WHOLE_UNITS.has(unit)
}

function httpError(status, message, extra = {}) {
  const error = new Error(message)
  error.status = status
  Object.assign(error, extra)
  return error
}

function parseAmount(raw, item, label) {
  if (raw == null || String(raw).trim() === '') return null
  const text = String(raw).trim()
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw httpError(400, `${item.item_name}: enter a number for the ${label}.`)
  }
  const amount = roundStock(text)
  if (amount == null || amount < 0) {
    throw httpError(400, `${item.item_name}: ${label} must be zero or greater.`)
  }
  if (!allowsDecimal(item) && !Number.isInteger(amount)) {
    throw httpError(400, `${item.item_name}: enter a whole number of ${item.unit_label}.`)
  }
  return amount
}

function percentChange(before, after) {
  if (before === after) return 0
  if (before === 0) return null
  return Math.round((Math.abs(after - before) / Math.abs(before)) * 1000) / 10
}

function isLargeChange(before, after) {
  if (before === after) return false
  if (before === 0) return after !== 0
  return Math.abs(after - before) / Math.abs(before) > 0.5
}

async function loadStockRows(conn) {
  const [rows] = await conn.execute(
    `SELECT id, item_name, category, section, unit_label, is_weight,
            stock_quantity, max_stock, low_threshold, critical_threshold
     FROM inventory
     WHERE archived_at IS NULL
     ORDER BY id
     FOR UPDATE`,
  )
  return rows
}

async function applyStocktake(conn, { rows, userId, confirmLarge = false, note }) {
  const stockRows = await loadStockRows(conn)
  const byId = new Map(stockRows.map((row) => [Number(row.id), row]))
  const seen = new Set()
  const changes = []

  for (const input of rows || []) {
    const id = Number(input.id)
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid stock item')
    if (seen.has(id)) throw httpError(400, 'Each stock item can only be entered once')
    seen.add(id)
    const item = byId.get(id)
    if (!item) throw httpError(400, 'One of the stock items is missing or archived')

    const counted = parseAmount(input.counted, item, 'counted quantity')
    const nextMax = parseAmount(input.max, item, 'maximum')
    const before = roundStock(item.stock_quantity)
    const maxBefore = roundStock(item.max_stock)
    const countChanged = counted != null && counted !== before
    const maxChanged = nextMax != null && nextMax !== maxBefore
    if (!countChanged && !maxChanged) continue
    changes.push({
      item,
      before,
      after: countChanged ? counted : before,
      countChanged,
      maxBefore,
      maxAfter: maxChanged ? nextMax : maxBefore,
      maxChanged,
      large: countChanged && isLargeChange(before, counted),
      percent: countChanged ? percentChange(before, counted) : 0,
    })
  }

  const large = changes.filter((row) => row.large)
  if (large.length && !confirmLarge) {
    throw httpError(409, 'Some counts differ by more than 50%. Confirm those rows to apply them.', {
      code: 'large_change',
      rows: large.map((row) => ({
        id: row.item.id,
        name: row.item.item_name,
        before: row.before,
        after: row.after,
        percent: row.percent,
        unit: row.item.unit_label,
      })),
    })
  }

  const applied = []
  for (const change of changes) {
    let movementId = null
    if (change.countChanged) {
      await applyStockChange(conn, {
        inventoryId: change.item.id,
        change: roundStock(change.after - change.before),
        reason: 'adjustment',
        userId,
        note,
      })
      const [inserted] = await conn.execute('SELECT LAST_INSERT_ID() AS id')
      movementId = Number(inserted[0].id)
    }
    if (change.maxChanged || change.countChanged) {
      const critical = change.item.critical_threshold == null
        ? null
        : Number(change.item.critical_threshold)
      const status = resolveStockStatus(
        change.after,
        Number(change.item.low_threshold ?? 0),
        critical,
      )
      await conn.execute(
        'UPDATE inventory SET max_stock = ?, stock_status = ? WHERE id = ?',
        [change.maxAfter, status, change.item.id],
      )
    }
    applied.push({
      id: change.item.id,
      name: change.item.item_name,
      unit: change.item.unit_label,
      before: change.before,
      after: change.after,
      difference: roundStock(change.after - change.before),
      percent: change.percent,
      maxBefore: change.maxBefore,
      maxAfter: change.maxAfter,
      movementId,
    })
  }

  applied.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
  return {
    note,
    changed: applied,
    blank: stockRows.length - applied.length,
    total: stockRows.length,
  }
}

async function buildStocktakeWorkbook(rows, note) {
  const ExcelJS = require('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Stocktake')
  sheet.columns = [
    { header: 'Item', key: 'name', width: 36 },
    { header: 'Unit', key: 'unit', width: 14 },
    { header: 'System count', key: 'before', width: 16 },
    { header: 'Counted', key: 'after', width: 14 },
    { header: 'Difference', key: 'difference', width: 14 },
    { header: 'Previous max', key: 'maxBefore', width: 16 },
    { header: 'New max', key: 'maxAfter', width: 14 },
  ]
  for (const row of rows) {
    sheet.addRow({
      name: row.name,
      unit: row.unit,
      before: Number(row.before),
      after: Number(row.after),
      difference: Number(row.difference),
      maxBefore: Number(row.maxBefore),
      maxAfter: Number(row.maxAfter),
    })
  }
  sheet.getRow(1).font = { bold: true }
  const buffer = await workbook.xlsx.writeBuffer()
  const day = String(note || '').replace('Opening stocktake ', '') || 'stocktake'
  return { buffer: Buffer.from(buffer), filename: `Stocktake_${day}.xlsx` }
}

module.exports = {
  WHOLE_UNITS,
  allowsDecimal,
  stocktakeNote,
  parseAmount,
  isLargeChange,
  applyStocktake,
  buildStocktakeWorkbook,
}
