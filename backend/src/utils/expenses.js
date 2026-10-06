const { columnExists } = require('./ordersSchema')

const PAID_FROM_VALUES = ['drawer', 'bank', 'owner']
const DEFAULT_PAID_FROM = 'drawer'

let schemaReadyPromise = null

function normalizePaidFrom(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_PAID_FROM
  const key = String(value).trim().toLowerCase()
  if (!PAID_FROM_VALUES.includes(key)) {
    throw Object.assign(new Error(`paid_from must be one of: ${PAID_FROM_VALUES.join(', ')}`), { status: 400 })
  }
  return key
}

function storedPaidFrom(value) {
  const key = String(value || '').trim().toLowerCase()
  return PAID_FROM_VALUES.includes(key) ? key : DEFAULT_PAID_FROM
}

async function ensureExpensesSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS expenses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          category VARCHAR(100) NOT NULL,
          description VARCHAR(500) NULL,
          amount DECIMAL(12, 2) NOT NULL,
          expense_date DATE NOT NULL,
          created_by INT NULL,
          created_by_name VARCHAR(120) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_expenses_date (expense_date),
          INDEX idx_expenses_category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      if (!(await columnExists(db, 'expenses', 'paid_from'))) {
        await db.execute(
          "ALTER TABLE expenses ADD COLUMN paid_from ENUM('drawer', 'bank', 'owner') NOT NULL DEFAULT 'drawer' AFTER amount",
        )
      }
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

function serializeExpense(row) {
  const rawDate = row.expense_date
  let expenseDate = ''
  if (typeof rawDate === 'string') {
    expenseDate = rawDate.slice(0, 10)
  } else if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    expenseDate = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`
  }

  return {
    id: row.id,
    category: row.category,
    description: row.description || '',
    amount: Number.parseFloat(row.amount) || 0,
    paid_from: storedPaidFrom(row.paid_from),
    expense_date: expenseDate,
    created_by: row.created_by,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
  }
}

async function listExpenses(db, { days = 365 } = {}) {
  await ensureExpensesSchema(db)
  const allowed = [30, 60, 90, 120, 180, 365, 730]
  const range = allowed.includes(Number(days)) ? Number(days) : 730
  const [rows] = await db.execute(
    `
    SELECT
      id, category, description, amount, paid_from,
      DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
      created_by, created_by_name, created_at
    FROM expenses
    WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    ORDER BY expense_date DESC, id DESC
    `,
    [range],
  )
  return rows.map(serializeExpense)
}

async function createExpense(db, payload, user) {
  await ensureExpensesSchema(db)
  const category = String(payload.category || '').trim()
  const description = String(payload.description || '').trim()
  const amount = Number(payload.amount)
  const expenseDate = String(payload.expense_date || '').trim() || new Date().toISOString().slice(0, 10)
  const paidFrom = normalizePaidFrom(payload.paid_from)

  if (!category) throw Object.assign(new Error('Expense category is required'), { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('Expense amount must be a positive number'), { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    throw Object.assign(new Error('expense_date must be YYYY-MM-DD'), { status: 400 })
  }

  const [result] = await db.execute(
    `
    INSERT INTO expenses (category, description, amount, paid_from, expense_date, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      category,
      description || null,
      amount,
      paidFrom,
      expenseDate,
      user?.id || null,
      user?.display_name || user?.username || null,
    ],
  )

  const [rows] = await db.execute('SELECT * FROM expenses WHERE id = ? LIMIT 1', [result.insertId])
  return serializeExpense(rows[0])
}

async function deleteExpense(db, expenseId) {
  await ensureExpensesSchema(db)
  const id = Number.parseInt(expenseId, 10)
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('Invalid expense id'), { status: 400 })
  }
  const [result] = await db.execute('DELETE FROM expenses WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw Object.assign(new Error('Expense not found'), { status: 404 })
  }
  return true
}

async function summarizeExpensesToday(db) {
  await ensureExpensesSchema(db)
  const [rows] = await db.execute(
    `
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE expense_date = CURDATE()
    `,
  )
  return Number.parseFloat(rows[0]?.total) || 0
}

module.exports = {
  PAID_FROM_VALUES,
  DEFAULT_PAID_FROM,
  normalizePaidFrom,
  ensureExpensesSchema,
  listExpenses,
  createExpense,
  deleteExpense,
  summarizeExpensesToday,
  serializeExpense,
}
