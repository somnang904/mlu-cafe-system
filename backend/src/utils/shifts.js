const { ensureInnoDb } = require('./stockSchema')

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
    })().catch((err) => {
      shiftsSchemaReady = null
      throw err
    })
  }
  return shiftsSchemaReady
}

async function getLiveShiftMetrics(db, startTime) {
  // Cash Sales
  const [cashRows] = await db.execute(
    `SELECT
       COALESCE(SUM(total), 0) AS total_usd,
       COALESCE(SUM(received_khr), 0) AS total_khr
     FROM orders
     WHERE status = 'Completed'
       AND payment_method = 'Cash'
       AND updated_at >= ?`,
    [startTime],
  )
  const cashSalesUsd = Math.round(Number(cashRows[0]?.total_usd || 0) * 100) / 100
  const cashSalesKhr = Math.round(Number(cashRows[0]?.total_khr || 0) * 100) / 100

  // Bank Scan Sales
  const [bankRows] = await db.execute(
    `SELECT
       COALESCE(SUM(total), 0) AS total_usd
     FROM orders
     WHERE status = 'Completed'
       AND payment_method = 'Bank Scan'
       AND updated_at >= ?`,
    [startTime],
  )
  const bankSalesUsd = Math.round(Number(bankRows[0]?.total_usd || 0) * 100) / 100

  // Expenses taken from till
  const [expenseRows] = await db.execute(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses
     FROM expenses
     WHERE created_at >= ?`,
    [startTime],
  )
  const expensesUsd = Math.round(Number(expenseRows[0]?.total_expenses || 0) * 100) / 100

  // Orders count
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS order_count
     FROM orders
     WHERE status = 'Completed'
       AND updated_at >= ?`,
    [startTime],
  )
  const orderCount = Number(countRows[0]?.order_count || 0)

  return {
    cashSalesUsd,
    cashSalesKhr,
    bankSalesUsd,
    expensesUsd,
    orderCount,
  }
}

async function getCurrentShift(db, userId = null) {
  await ensureShiftsSchema(db)

  const [rows] = await db.execute(
    `SELECT * FROM shifts WHERE status = 'Open' ORDER BY id DESC LIMIT 1`,
  )
  if (!rows.length) return null

  const shift = rows[0]
  const metrics = await getLiveShiftMetrics(db, shift.start_time)

  const openFloatUsd = Number(shift.opening_float_usd || 0)
  const openFloatKhr = Number(shift.opening_float_khr || 0)
  const expectedCashUsd = Math.round((openFloatUsd + metrics.cashSalesUsd - metrics.expensesUsd) * 100) / 100
  const expectedCashKhr = Math.round((openFloatKhr + metrics.cashSalesKhr) * 100) / 100

  return {
    id: shift.id,
    user_id: shift.user_id,
    cashier_name: shift.cashier_name,
    start_time: shift.start_time,
    status: shift.status,
    opening_float_usd: openFloatUsd,
    opening_float_khr: openFloatKhr,
    cash_sales_usd: metrics.cashSalesUsd,
    cash_sales_khr: metrics.cashSalesKhr,
    bank_sales_usd: metrics.bankSalesUsd,
    expenses_usd: metrics.expensesUsd,
    expected_cash_usd: expectedCashUsd,
    expected_cash_khr: expectedCashKhr,
    order_count: metrics.orderCount,
  }
}

async function startShift(db, { userId, cashierName, openingFloatUsd = 0, openingFloatKhr = 0 }) {
  await ensureShiftsSchema(db)

  const [existing] = await db.execute(
    `SELECT id FROM shifts WHERE status = 'Open' LIMIT 1`,
  )
  if (existing.length) {
    const error = new Error('An active shift is already open. Please close it first.')
    error.status = 400
    throw error
  }

  const parsedFloatUsd = Math.max(0, Math.round(Number(openingFloatUsd || 0) * 100) / 100)
  const parsedFloatKhr = Math.max(0, Math.round(Number(openingFloatKhr || 0)))

  const [result] = await db.execute(
    `INSERT INTO shifts
      (user_id, cashier_name, opening_float_usd, opening_float_khr, expected_cash_usd, expected_cash_khr, status)
     VALUES (?, ?, ?, ?, ?, ?, 'Open')`,
    [userId, cashierName || 'Cashier', parsedFloatUsd, parsedFloatKhr, parsedFloatUsd, parsedFloatKhr],
  )

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
  const metrics = await getLiveShiftMetrics(db, shift.start_time)

  const openFloatUsd = Number(shift.opening_float_usd || 0)
  const openFloatKhr = Number(shift.opening_float_khr || 0)
  const expectedCashUsd = Math.round((openFloatUsd + metrics.cashSalesUsd - metrics.expensesUsd) * 100) / 100
  const expectedCashKhr = Math.round((openFloatKhr + metrics.cashSalesKhr) * 100) / 100

  const countUsd = Math.round(Number(closingCashUsd || 0) * 100) / 100
  const countKhr = Math.round(Number(closingCashKhr || 0))
  const diffUsd = Math.round((countUsd - expectedCashUsd) * 100) / 100
  const diffKhr = Math.round(countKhr - expectedCashKhr)

  await db.execute(
    `UPDATE shifts
     SET end_time = NOW(),
         cash_sales_usd = ?,
         cash_sales_khr = ?,
         bank_sales_usd = ?,
         expenses_usd = ?,
         expected_cash_usd = ?,
         expected_cash_khr = ?,
         closing_cash_usd = ?,
         closing_cash_khr = ?,
         difference_usd = ?,
         difference_khr = ?,
         notes = ?,
         status = 'Closed'
     WHERE id = ?`,
    [
      metrics.cashSalesUsd,
      metrics.cashSalesKhr,
      metrics.bankSalesUsd,
      metrics.expensesUsd,
      expectedCashUsd,
      expectedCashKhr,
      countUsd,
      countKhr,
      diffUsd,
      diffKhr,
      String(notes || '').trim().slice(0, 500),
      shiftId,
    ],
  )

  const [updated] = await db.execute('SELECT * FROM shifts WHERE id = ?', [shiftId])
  return {
    ...updated[0],
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
  getCurrentShift,
  startShift,
  endShift,
  listShiftHistory,
}
