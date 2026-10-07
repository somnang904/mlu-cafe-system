const { ensureInnoDb } = require('./stockSchema')
const { columnExists } = require('./ordersSchema')
const { summarizeCashOrders, computeCashDifference } = require('./cashDrawer')
const { ensureExpensesSchema } = require('./expenses')

let shiftsSchemaReady = null

async function ensureShiftsSchema(db) {
  if (!shiftsSchemaReady) {
    shiftsSchemaReady = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS shifts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          cashier_name VARCHAR(100) NOT NULL,
          start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          end_time TIMESTAMP NULL,
          opening_float_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          opening_float_khr DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          cash_sales_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          cash_sales_khr DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          bank_sales_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          expenses_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          expected_cash_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          expected_cash_khr DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          closing_cash_usd DECIMAL(10,2) NULL,
          closing_cash_khr DECIMAL(14,2) NULL,
          difference_usd DECIMAL(10,2) NULL,
          difference_khr DECIMAL(14,2) NULL,
          notes VARCHAR(500) NULL,
          status ENUM('Open', 'Closed') NOT NULL DEFAULT 'Open',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_shifts_status (status),
          INDEX idx_shifts_user (user_id)
        ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      `)
      await ensureInnoDb(db, 'shifts')
      if (!(await columnExists(db, 'shifts', 'cash_net_usd'))) {
        await db.execute('ALTER TABLE shifts ADD COLUMN cash_net_usd DECIMAL(10,2) NULL AFTER cash_sales_khr')
      }
      if (!(await columnExists(db, 'shifts', 'exchange_rate'))) {
        await db.execute('ALTER TABLE shifts ADD COLUMN exchange_rate DECIMAL(10,2) NULL AFTER difference_khr')
      }
      if (!(await columnExists(db, 'shifts', 'difference_total_usd'))) {
        await db.execute('ALTER TABLE shifts ADD COLUMN difference_total_usd DECIMAL(10,2) NULL AFTER exchange_rate')
      }
    })().catch((err) => {
      shiftsSchemaReady = null
      throw err
    })
  }
  return shiftsSchemaReady
}

function shiftError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

async function dbNow(db) {
  const [rows] = await db.execute('SELECT NOW() AS now')
  return rows[0].now
}

async function withShiftLock(db, fn) {
  const conn = await db.getConnection()
  try {
    const [lockRows] = await conn.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':shift-open'), 10) AS got")
    if (Number(lockRows[0]?.got) !== 1) {
      throw shiftError('Another shift change is in progress. Please try again.', 409)
    }
    try {
      return await fn(conn)
    } finally {
      await conn.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':shift-open'))")
    }
  } finally {
    conn.release()
  }
}

const MAX_CASH_USD = 1000000
const MAX_CASH_KHR = 4000000000

function parseCount(value, label, { required, max = null }) {
  if (value === null || value === undefined || value === '') {
    if (required) throw shiftError(`${label} is required`, 400)
    return 0
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw shiftError(`${label} must be a non-negative number`, 400)
  }
  if (max != null && number > max) {
    throw shiftError(`${label} cannot be more than ${max.toLocaleString('en-US')}`, 400)
  }
  return number
}

async function getLiveShiftMetrics(db, startTime, endTime) {
  // Cash Sales
  const [cashRows] = await db.execute(
    `SELECT total, received_usd, received_khr, change_usd, change_khr, exchange_rate
     FROM orders
     WHERE status = 'Completed'
       AND payment_method = 'Cash'
       AND updated_at >= ? AND updated_at <= ?
     ORDER BY updated_at ASC, id ASC`,
    [startTime, endTime],
  )
  const cash = summarizeCashOrders(cashRows)
  const cashSalesUsd = cash.netUsd
  const cashSalesKhr = cash.netKhr

  // Bank Scan Sales
  const [bankRows] = await db.execute(
    `SELECT
       COALESCE(SUM(total), 0) AS total_usd
     FROM orders
     WHERE status = 'Completed'
       AND payment_method = 'Bank Scan'
       AND updated_at >= ? AND updated_at <= ?`,
    [startTime, endTime],
  )
  const bankSalesUsd = Math.round(Number(bankRows[0]?.total_usd || 0) * 100) / 100

  // Expenses taken from the till, counted when paid (an unpaid bill hasn't left the drawer yet).
  await ensureExpensesSchema(db)
  const [expenseRows] = await db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses
     FROM expenses
     WHERE paid_from = 'drawer'
       AND status = 'paid'
       AND COALESCE(paid_at, created_at) >= ? AND COALESCE(paid_at, created_at) <= ?`,
    [startTime, endTime],
  )
  const expensesUsd = Math.round(Number(expenseRows[0]?.total_expenses || 0) * 100) / 100

  const [refundRows] = await db.execute(
    `SELECT COALESCE(SUM(total), 0) AS total_usd
     FROM orders
     WHERE status = 'Refunded'
       AND payment_method = 'Cash'
       AND voided_at >= ?
       AND updated_at < ?`,
    [startTime, startTime],
  )
  const cashRefundsUsd = Math.round(Number(refundRows[0]?.total_usd || 0) * 100) / 100

  // Orders count
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS order_count
     FROM orders
     WHERE status = 'Completed'
       AND updated_at >= ? AND updated_at <= ?`,
    [startTime, endTime],
  )
  const orderCount = Number(countRows[0]?.order_count || 0)

  return {
    cashSalesValueUsd: cash.salesUsd,
    exchangeRate: cash.exchangeRate,
    cashSalesUsd,
    cashSalesKhr,
    bankSalesUsd,
    expensesUsd,
    cashRefundsUsd,
    orderCount,
  }
}

function expectedDrawerUsd(openingFloatUsd, metrics) {
  const total = openingFloatUsd + metrics.cashSalesUsd - metrics.expensesUsd - (metrics.cashRefundsUsd || 0)
  return Math.round(total * 100) / 100
}

async function getCurrentShift(db, userId = null) {
  await ensureShiftsSchema(db)

  const [rows] = await db.execute(
    `SELECT * FROM shifts WHERE status = 'Open' ORDER BY id DESC LIMIT 1`,
  )
  if (!rows.length) return null

  const shift = rows[0]
  const metrics = await getLiveShiftMetrics(db, shift.start_time, await dbNow(db))

  const openFloatUsd = Number(shift.opening_float_usd || 0)
  const openFloatKhr = Number(shift.opening_float_khr || 0)
  const expectedCashUsd = expectedDrawerUsd(openFloatUsd, metrics)
  const expectedCashKhr = Math.round((openFloatKhr + metrics.cashSalesKhr) * 100) / 100

  return {
    id: shift.id,
    user_id: shift.user_id,
    cashier_name: shift.cashier_name,
    start_time: shift.start_time,
    status: shift.status,
    opening_float_usd: openFloatUsd,
    opening_float_khr: openFloatKhr,
    cash_sales_usd: metrics.cashSalesValueUsd,
    cash_net_usd: metrics.cashSalesUsd,
    exchange_rate: metrics.exchangeRate,
    cash_sales_khr: metrics.cashSalesKhr,
    bank_sales_usd: metrics.bankSalesUsd,
    expenses_usd: metrics.expensesUsd,
    cash_refunds_usd: metrics.cashRefundsUsd,
    expected_cash_usd: expectedCashUsd,
    expected_cash_khr: expectedCashKhr,
    order_count: metrics.orderCount,
  }
}

async function startShift(db, { userId, cashierName, openingFloatUsd = 0, openingFloatKhr = 0 }) {
  await ensureShiftsSchema(db)

  const parsedFloatUsd = Math.round(parseCount(openingFloatUsd, 'opening_float_usd', { required: false, max: MAX_CASH_USD }) * 100) / 100
  const parsedFloatKhr = Math.round(parseCount(openingFloatKhr, 'opening_float_khr', { required: false, max: MAX_CASH_KHR }))

  await withShiftLock(db, async (conn) => {
    const [existing] = await conn.execute(
      `SELECT id FROM shifts WHERE status = 'Open' LIMIT 1`,
    )
    if (existing.length) {
      throw shiftError('An active shift is already open. Please close it first.', 400)
    }

    await conn.execute(
      `INSERT INTO shifts
        (user_id, cashier_name, opening_float_usd, opening_float_khr, expected_cash_usd, expected_cash_khr, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Open')`,
      [userId, cashierName || 'Cashier', parsedFloatUsd, parsedFloatKhr, parsedFloatUsd, parsedFloatKhr],
    )
  })

  return getCurrentShift(db, userId)
}

async function endShift(db, { shiftId, closingCashUsd, closingCashKhr, notes = '' }) {
  await ensureShiftsSchema(db)

  const [rows] = await db.execute(
    `SELECT * FROM shifts WHERE id = ? AND status = 'Open' LIMIT 1`,
    [shiftId],
  )
  if (!rows.length) {
    const error = new Error('Shift not found or already closed')
    error.status = 404
    throw error
  }

  const shift = rows[0]
  const endTime = await dbNow(db)
  const metrics = await getLiveShiftMetrics(db, shift.start_time, endTime)

  const openFloatUsd = Number(shift.opening_float_usd || 0)
  const openFloatKhr = Number(shift.opening_float_khr || 0)
  const expectedCashUsd = expectedDrawerUsd(openFloatUsd, metrics)
  const expectedCashKhr = Math.round((openFloatKhr + metrics.cashSalesKhr) * 100) / 100

  const countUsd = Math.round(parseCount(closingCashUsd, 'closing_cash_usd', { required: true, max: MAX_CASH_USD }) * 100) / 100
  const countKhr = Math.round(parseCount(closingCashKhr, 'closing_cash_khr', { required: false, max: MAX_CASH_KHR }))
  const diffUsd = Math.round((countUsd - expectedCashUsd) * 100) / 100
  const diffKhr = Math.round(countKhr - expectedCashKhr)
  const diff = computeCashDifference({
    expectedUsd: expectedCashUsd,
    expectedKhr: expectedCashKhr,
    countedUsd: countUsd,
    countedKhr: countKhr,
    exchangeRate: metrics.exchangeRate,
  })

  const [result] = await db.execute(
    `UPDATE shifts
     SET end_time = ?,
         cash_sales_usd = ?,
         cash_sales_khr = ?,
         cash_net_usd = ?,
         bank_sales_usd = ?,
         expenses_usd = ?,
         expected_cash_usd = ?,
         expected_cash_khr = ?,
         closing_cash_usd = ?,
         closing_cash_khr = ?,
         difference_usd = ?,
         difference_khr = ?,
         exchange_rate = ?,
         difference_total_usd = ?,
         notes = ?,
         status = 'Closed'
     WHERE id = ? AND status = 'Open'`,
    [
      endTime,
      metrics.cashSalesValueUsd,
      metrics.cashSalesKhr,
      metrics.cashSalesUsd,
      metrics.bankSalesUsd,
      metrics.expensesUsd,
      expectedCashUsd,
      expectedCashKhr,
      countUsd,
      countKhr,
      diffUsd,
      diffKhr,
      metrics.exchangeRate,
      diff.totalUsd,
      String(notes || '').trim().slice(0, 500),
      shiftId,
    ],
  )
  if (result.affectedRows === 0) {
    throw shiftError('Shift not found or already closed', 404)
  }

  const [updated] = await db.execute('SELECT * FROM shifts WHERE id = ?', [shiftId])
  return {
    ...updated[0],
    cash_refunds_usd: metrics.cashRefundsUsd,
    order_count: metrics.orderCount,
  }
}

async function listShiftHistory(db, limit = 30) {
  await ensureShiftsSchema(db)
  const [rows] = await db.execute(
    `SELECT * FROM shifts WHERE status = 'Closed' ORDER BY id DESC LIMIT ?`,
    [Number(limit) || 30],
  )
  return rows
}

module.exports = {
  ensureShiftsSchema,
  getLiveShiftMetrics,
  expectedDrawerUsd,
  getCurrentShift,
  startShift,
  endShift,
  listShiftHistory,
}
