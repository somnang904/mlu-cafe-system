const { isAdminRole } = require('../constants/permissions')
const { loadReportData } = require('./reportExport')
const { parseReportRange, roundMoney } = require('./exportParams')
const { saleStatusSql } = require('./salesTotals')

// End-of-day close reports. Closing saves a snapshot of the day's figures, so a closed day reads
// the same later even if sales or expenses change afterwards. A cashier closes their own sales
// and expenses; an admin closes the whole shop. Closing the same day again replaces the snapshot.
const SOLD = saleStatusSql()
const TOTAL_SQL = 'COALESCE(total, total_amount, 0)'
const NOTE_MAX = 500
const TOP_ITEMS = 15

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

let schemaReady = null
async function ensureDayCloseSchema(db) {
  if (!schemaReady) {
    schemaReady = db.execute(`
      CREATE TABLE IF NOT EXISTS day_closes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_date DATE NOT NULL,
        user_id INT NOT NULL,
        user_name VARCHAR(120) NULL,
        scope ENUM('own', 'shop') NOT NULL,
        net_sales DECIMAL(12, 2) NOT NULL DEFAULT 0,
        orders_count INT NOT NULL DEFAULT 0,
        snapshot LONGTEXT NOT NULL,
        note VARCHAR(500) NULL,
        closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL,
        UNIQUE KEY uniq_day_close (business_date, user_id),
        INDEX idx_day_close_date (business_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

/** Whose figures this user closes: their own (staffId) or the whole shop (null). */
function closeScope(user) {
  return isAdminRole(user?.role) ? { scope: 'shop', staffId: null } : { scope: 'own', staffId: user?.id ?? -1 }
}

async function todayKey(db) {
  const [[row]] = await db.execute("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today")
  return row.today
}

/** The business day to close: YYYY-MM-DD, not in the future; today when left out. */
async function resolveDate(db, rawDate) {
  const today = await todayKey(db)
  if (rawDate === undefined || rawDate === null || rawDate === '') return today
  const date = String(rawDate).trim()
  parseReportRange(date, date)
  if (date > today) throw httpError(400, 'You cannot close a day that has not happened yet')
  return date
}

async function paymentBreakdown(db, period, staffId) {
  const mine = staffId != null ? ' AND staff_id = ?' : ''
  const [rows] = await db.execute(
    `SELECT COALESCE(NULLIF(payment_method, ''), 'Cash') AS method, NULLIF(payment_bank, '') AS bank,
            COUNT(*) AS orders, COALESCE(SUM(${TOTAL_SQL}), 0) AS amount
     FROM orders
     WHERE ${SOLD} AND updated_at >= ? AND updated_at < ?${mine}
     GROUP BY method, bank
     ORDER BY amount DESC`,
    [period.startDate, period.endDate, ...(staffId != null ? [staffId] : [])],
  )
  return rows.map((row) => ({
    method: row.method,
    bank: row.bank || null,
    orders: Number(row.orders) || 0,
    amount: roundMoney(Number(row.amount) || 0),
  }))
}

async function itemsSold(db, period, staffId) {
  const mine = staffId != null ? ' AND staff_id = ?' : ''
  const [rows] = await db.execute(
    `SELECT COALESCE(m.name, oi.item_name, 'Custom item') AS name,
            SUM(oi.quantity) AS qty, COALESCE(SUM(oi.quantity * oi.price), 0) AS amount
     FROM order_items oi
     LEFT JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE oi.order_id IN (
       SELECT id FROM orders WHERE ${SOLD} AND updated_at >= ? AND updated_at < ?${mine}
     )
     GROUP BY name
     ORDER BY qty DESC, amount DESC
     LIMIT ${TOP_ITEMS}`,
    [period.startDate, period.endDate, ...(staffId != null ? [staffId] : [])],
  )
  return rows.map((row) => ({ name: row.name, qty: Number(row.qty) || 0, amount: roundMoney(Number(row.amount) || 0) }))
}

/** The day's figures for this user's scope, as they are right now. */
async function buildDaySnapshot(db, date, staffId) {
  const period = parseReportRange(date, date)
  const data = await loadReportData(db, period, staffId)
  return {
    date,
    summary: {
      ...data.summary,
      salesUsd: data.taken.salesUsd,
      salesKhr: data.taken.salesKhr,
      refundsUsd: data.taken.refundsUsd,
      refundsKhr: data.taken.refundsKhr,
      expensesUsd: roundMoney(data.spending.reduce((sum, row) => sum + (row.usd || 0), 0)),
      expensesKhr: data.spending.reduce((sum, row) => sum + (row.khr || 0), 0),
    },
    payments: await paymentBreakdown(db, period, staffId),
    items: await itemsSold(db, period, staffId),
    spending: data.spending,
  }
}

function serializeClose(row, { withSnapshot = false } = {}) {
  const base = {
    id: row.id,
    date: row.business_date_key,
    user_id: row.user_id,
    user_name: row.user_name || '',
    scope: row.scope,
    net_sales: Number(row.net_sales) || 0,
    orders: Number(row.orders_count) || 0,
    note: row.note || '',
    closed_at: row.closed_at,
    updated_at: row.updated_at || null,
  }
  if (!withSnapshot) return base
  let snapshot
  try {
    snapshot = JSON.parse(row.snapshot)
  } catch {
    snapshot = null
  }
  return { ...base, snapshot }
}

const SELECT_CLOSE = `SELECT *, DATE_FORMAT(business_date, '%Y-%m-%d') AS business_date_key FROM day_closes`

async function findClose(db, date, userId) {
  const [rows] = await db.execute(`${SELECT_CLOSE} WHERE business_date = ? AND user_id = ? LIMIT 1`, [date, userId])
  return rows[0] ? serializeClose(rows[0], { withSnapshot: true }) : null
}

/** Today's (or `date`'s) figures so far, and the close already saved for it, if any. */
async function previewDayClose(db, user, rawDate) {
  await ensureDayCloseSchema(db)
  const date = await resolveDate(db, rawDate)
  const { scope, staffId } = closeScope(user)
  return {
    date,
    scope,
    snapshot: await buildDaySnapshot(db, date, staffId),
    existing: await findClose(db, date, user.id),
  }
}

/** Saves (or replaces) this user's close for the day. */
async function closeDay(db, user, { date: rawDate, note } = {}) {
  await ensureDayCloseSchema(db)
  const date = await resolveDate(db, rawDate)
  const { scope, staffId } = closeScope(user)
  const cleanNote = String(note ?? '').trim()
  if (cleanNote.length > NOTE_MAX) throw httpError(400, `Note must be ${NOTE_MAX} characters or less`)
  const snapshot = await buildDaySnapshot(db, date, staffId)
  await db.execute(
    `INSERT INTO day_closes (business_date, user_id, user_name, scope, net_sales, orders_count, snapshot, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_name = VALUES(user_name), scope = VALUES(scope), net_sales = VALUES(net_sales),
       orders_count = VALUES(orders_count), snapshot = VALUES(snapshot), note = VALUES(note), updated_at = NOW()`,
    [
      date,
      user.id,
      user.display_name || user.username || null,
      scope,
      snapshot.summary.net,
      snapshot.summary.orders,
      JSON.stringify(snapshot),
      cleanNote || null,
    ],
  )
  return findClose(db, date, user.id)
}

/** Saved closes, newest first: every one for an admin, a cashier's own otherwise. */
async function listDayCloses(db, user, rawLimit) {
  await ensureDayCloseSchema(db)
  const limit = Math.min(Math.max(Number.parseInt(rawLimit, 10) || 60, 1), 366)
  const own = isAdminRole(user?.role) ? '' : 'WHERE user_id = ?'
  const [rows] = await db.execute(
    `${SELECT_CLOSE} ${own} ORDER BY business_date DESC, closed_at DESC LIMIT ${limit}`,
    own ? [user.id] : [],
  )
  return rows.map((row) => serializeClose(row))
}

/** One saved close with its snapshot; 404 for someone else's unless an admin asks. */
async function getDayClose(db, user, rawId) {
  await ensureDayCloseSchema(db)
  const id = Number.parseInt(rawId, 10)
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Invalid close report id')
  const [rows] = await db.execute(`${SELECT_CLOSE} WHERE id = ? LIMIT 1`, [id])
  const row = rows[0]
  if (!row || (!isAdminRole(user?.role) && Number(row.user_id) !== Number(user?.id))) {
    throw httpError(404, 'Close report not found')
  }
  return serializeClose(row, { withSnapshot: true })
}

module.exports = {
  ensureDayCloseSchema,
  previewDayClose,
  closeDay,
  listDayCloses,
  getDayClose,
}
