const fs = require('fs')
const path = require('path')
const { columnExists } = require('./ordersSchema')

const PAID_FROM_VALUES = ['drawer', 'bank', 'owner']
const DEFAULT_PAID_FROM = 'drawer'
// How the bill was paid. Cash comes from the till ("drawer") or the owner's pocket; the rest is "bank".
const EXPENSE_METHODS = ['cash', 'aba_khqr', 'card', 'bank_transfer']
const EXPENSE_STATUSES = ['paid', 'unpaid']
const NOTE_MAX = 500
const VENDOR_MAX = 160
const TITLE_MAX = 160

// Colors are Tailwind palette names the frontend already uses, not new hex values.
const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Ingredients', color: 'forest' },
  { name: 'Salary', color: 'sky' },
  { name: 'Rent', color: 'violet' },
  { name: 'Utilities', color: 'amber' },
  { name: 'Marketing', color: 'rose' },
  { name: 'Maintenance', color: 'teal' },
  { name: 'Other', color: 'slate' },
]
const EXTRA_CATEGORY_COLORS = ['orange', 'cyan', 'lime', 'fuchsia', 'indigo', 'stone']
// Category text stored before expense_categories existed → the default category it now belongs to.
// Anything else (e.g. "Transport", "Supplies") becomes a category of its own.
const LEGACY_CATEGORY_NAMES = {
  'inventory restock': 'Ingredients',
  payroll: 'Salary',
  'staff / payroll': 'Salary',
  others: 'Other',
  other: 'Other',
  utilities: 'Utilities',
}
// Receipt photos are stored as <name>-<time>-<random>.webp by saveMenuImage.
const RECEIPT_FILE_PATTERN = /^[a-zA-Z0-9_-]{1,80}\.(webp|jpe?g|png|gif|avif)$/

let schemaReadyPromise = null

function badRequest(message, field) {
  return Object.assign(new Error(message), { status: 400, field })
}

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

function cleanText(value, max) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function monthOf(dateKey) {
  return String(dateKey || '').slice(0, 7)
}

function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

async function addColumn(db, column, definition) {
  if (await columnExists(db, 'expenses', column)) return false
  await db.execute(`ALTER TABLE expenses ADD COLUMN ${column} ${definition}`)
  return true
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

      await db.execute(`
        CREATE TABLE IF NOT EXISTS expense_categories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(60) NOT NULL,
          color VARCHAR(20) NOT NULL DEFAULT 'slate',
          sort_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_expense_category_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      for (const [index, category] of DEFAULT_EXPENSE_CATEGORIES.entries()) {
        await db.execute(
          'INSERT IGNORE INTO expense_categories (name, color, sort_order) VALUES (?, ?, ?)',
          [category.name, category.color, index + 1],
        )
      }

      // The `description` column holds the note; `category` keeps the category name so older
      // readers (reports, exports, shift totals) still work without a join.
      await addColumn(db, 'category_id', 'INT NULL AFTER category')
      await addColumn(db, 'vendor', 'VARCHAR(160) NULL AFTER description')
      // Short name for the expense ("Buy vegetables"); shown first in the list.
      await addColumn(db, 'title', 'VARCHAR(160) NULL AFTER category_id')
      const addedMethod = await addColumn(db, 'method', "VARCHAR(20) NOT NULL DEFAULT 'cash' AFTER amount")
      if (addedMethod) {
        await db.execute("UPDATE expenses SET method = 'bank_transfer' WHERE paid_from = 'bank'")
      }
      await addColumn(db, 'status', "ENUM('paid', 'unpaid') NOT NULL DEFAULT 'paid' AFTER method")
      await addColumn(db, 'receipt_file', 'VARCHAR(120) NULL AFTER status')
      await addColumn(db, 'is_recurring', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER receipt_file')
      // A monthly series: the first expense is the root; copies point at it.
      await addColumn(db, 'recurring_parent_id', 'INT NULL AFTER is_recurring')
      await addColumn(db, 'recurring_last_month', 'CHAR(7) NULL AFTER recurring_parent_id')
      // When it was paid; the till total of a shift counts drawer expenses by this time.
      await addColumn(db, 'paid_at', 'TIMESTAMP NULL AFTER recurring_last_month')
      await addColumn(db, 'updated_at', 'TIMESTAMP NULL AFTER created_at')

      await linkExpenseCategories(db)
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

async function listExpenseCategories(db) {
  await ensureExpensesSchema(db)
  const [rows] = await db.execute('SELECT id, name, color FROM expense_categories ORDER BY sort_order, id')
  return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }))
}

/** The id of the category called `rawName` (ignoring case), created if it doesn't exist yet. */
async function findOrCreateCategory(db, rawName) {
  const name = cleanText(rawName, 60)
  const [found] = await db.execute('SELECT id, name FROM expense_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
  if (found[0]) return found[0]
  const [[{ count }]] = await db.execute('SELECT COUNT(*) AS count FROM expense_categories')
  const color = EXTRA_CATEGORY_COLORS[Math.max(0, Number(count) - DEFAULT_EXPENSE_CATEGORIES.length) % EXTRA_CATEGORY_COLORS.length]
  try {
    const [result] = await db.execute(
      'INSERT INTO expense_categories (name, color, sort_order) VALUES (?, ?, ?)',
      [name, color, Number(count) + 1],
    )
    return { id: result.insertId, name }
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error
    const [again] = await db.execute('SELECT id, name FROM expense_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
    return again[0]
  }
}

/** Gives every expense without a category_id one, from its category text (old rows, seed scripts). */
async function linkExpenseCategories(db) {
  const [rows] = await db.execute('SELECT DISTINCT category FROM expenses WHERE category_id IS NULL')
  for (const { category } of rows) {
    const raw = cleanText(category, 60) || 'Other'
    const target = await findOrCreateCategory(db, LEGACY_CATEGORY_NAMES[raw.toLowerCase()] || raw)
    await db.execute(
      'UPDATE expenses SET category_id = ?, category = ? WHERE category_id IS NULL AND category = ?',
      [target.id, target.name, category],
    )
  }
}

function serializeDate(rawDate) {
  if (typeof rawDate === 'string') return rawDate.slice(0, 10)
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    return `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`
  }
  return ''
}

function serializeExpense(row) {
  const receipt = row.receipt_file || null
  return {
    id: row.id,
    category_id: row.category_id ?? null,
    category: row.category_name || row.category,
    category_color: row.category_color || 'slate',
    title: row.title || '',
    vendor: row.vendor || '',
    description: row.description || '',
    note: row.description || '',
    amount: Number.parseFloat(row.amount) || 0,
    method: EXPENSE_METHODS.includes(row.method) ? row.method : 'cash',
    status: row.status === 'unpaid' ? 'unpaid' : 'paid',
    paid_from: storedPaidFrom(row.paid_from),
    expense_date: serializeDate(row.expense_date),
    has_receipt: Boolean(receipt),
    receipt_url: receipt ? `/expenses/${row.id}/receipt` : null,
    is_recurring: Boolean(Number(row.is_recurring)),
    recurring_parent_id: row.recurring_parent_id ?? null,
    created_by: row.created_by,
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at || null,
  }
}

const SELECT_EXPENSE = `
  SELECT
    e.id, e.category, e.category_id, e.title, e.description, e.vendor, e.amount, e.method, e.status, e.paid_from,
    e.receipt_file, e.is_recurring, e.recurring_parent_id,
    DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date,
    e.created_by, e.created_by_name, e.created_at, e.updated_at,
    c.name AS category_name, c.color AS category_color
  FROM expenses e
  LEFT JOIN expense_categories c ON c.id = e.category_id
`

async function getExpense(db, id) {
  const [rows] = await db.execute(`${SELECT_EXPENSE} WHERE e.id = ? LIMIT 1`, [id])
  return rows[0] ? serializeExpense(rows[0]) : null
}

function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

/** Same day of the month as `dateKey`, in `monthKey`, clamped (the 31st → the 30th in April). */
function sameDayIn(monthKey, dateKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Number(dateKey.slice(8, 10)), lastDay)
  return `${monthKey}-${String(day).padStart(2, '0')}`
}

/**
 * "Repeat monthly": once a new month starts, add that month's copy of each repeating expense,
 * dated on the same day and marked unpaid. recurring_last_month remembers the last month added,
 * so a copy that someone deleted is not added back. The guarded UPDATE makes two requests at the
 * same time add each month only once.
 */
async function materializeRecurringExpenses(db, now = new Date()) {
  const currentMonth = monthOf(todayKey(now))
  const [roots] = await db.execute(
    `SELECT id, category, category_id, title, description, vendor, amount, method, paid_from,
            DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date, created_by, created_by_name,
            COALESCE(recurring_last_month, DATE_FORMAT(expense_date, '%Y-%m')) AS last_month
     FROM expenses
     WHERE is_recurring = 1 AND recurring_parent_id IS NULL`,
  )
  let added = 0
  for (const root of roots) {
    let lastMonth = root.last_month
    while (lastMonth < currentMonth) {
      const month = nextMonthKey(lastMonth)
      const [claim] = await db.execute(
        `UPDATE expenses SET recurring_last_month = ?
         WHERE id = ? AND is_recurring = 1 AND COALESCE(recurring_last_month, DATE_FORMAT(expense_date, '%Y-%m')) = ?`,
        [month, root.id, lastMonth],
      )
      if (!claim.affectedRows) break
      await db.execute(
        `INSERT INTO expenses
           (category, category_id, description, vendor, amount, method, status, paid_from, expense_date,
            is_recurring, recurring_parent_id, created_by, created_by_name, title)
         VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, 1, ?, ?, ?, ?)`,
        [
          root.category, root.category_id, root.description, root.vendor, root.amount, root.method,
          root.paid_from, sameDayIn(month, root.expense_date), root.id, root.created_by, root.created_by_name,
          root.title ?? null,
        ],
      )
      added += 1
      lastMonth = month
    }
  }
  return added
}

/**
 * Either the last `days` days ('all' for every expense), or `from` (inclusive) to `toExclusive`
 * (YYYY-MM-DD). `status` ('paid' | 'unpaid') narrows it further.
 */
async function listExpenses(db, { days = 365, from = null, toExclusive = null, status = null } = {}) {
  await ensureExpensesSchema(db)
  await linkExpenseCategories(db)
  await materializeRecurringExpenses(db)
  const allowed = [30, 60, 90, 120, 180, 365, 730]
  const range = allowed.includes(Number(days)) ? Number(days) : 730
  const byDates = isValidDateKey(from) && isValidDateKey(toExclusive)
  const where = []
  const params = []
  if (byDates) {
    where.push('e.expense_date >= ? AND e.expense_date < ?')
    params.push(from, toExclusive)
  } else if (days !== 'all') {
    where.push('e.expense_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)')
    params.push(range)
  }
  if (EXPENSE_STATUSES.includes(status)) {
    where.push('e.status = ?')
    params.push(status)
  }
  const [rows] = await db.execute(
    `${SELECT_EXPENSE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.expense_date DESC, e.id DESC`,
    params,
  )
  return rows.map(serializeExpense)
}

/** Totals that don't depend on the page's period: everything still unpaid, and the monthly repeats. */
async function expenseOverview(db) {
  await ensureExpensesSchema(db)
  await materializeRecurringExpenses(db)
  const [[unpaid]] = await db.execute(
    "SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE status = 'unpaid'",
  )
  const [[recurring]] = await db.execute(
    'SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE is_recurring = 1 AND recurring_parent_id IS NULL',
  )
  return {
    unpaid: { amount: Number.parseFloat(unpaid.amount) || 0, count: Number(unpaid.count) || 0 },
    recurring: { monthlyTotal: Number.parseFloat(recurring.amount) || 0, count: Number(recurring.count) || 0 },
  }
}

/**
 * Checks and normalizes an add/edit form. `existing` is the stored expense when editing (fields
 * left out keep their value). Throws a 400 with `field` set to the first field that is wrong.
 */
async function normalizeExpenseInput(db, payload, { existing = null, receiptsDir = null } = {}) {
  const pick = (key, fallback) => (payload[key] !== undefined ? payload[key] : fallback)

  // Adding without a date means today (as before); the form itself requires one.
  const expenseDate = String(pick('expense_date', pick('date', existing?.expense_date ?? '')) || '').trim()
    || (existing ? '' : todayKey())
  if (!expenseDate) throw badRequest('Choose the date', 'date')
  if (!isValidDateKey(expenseDate)) throw badRequest('expense_date must be YYYY-MM-DD', 'date')

  const rawAmount = pick('amount', existing?.amount)
  const amount = Number(rawAmount)
  if (rawAmount === '' || rawAmount == null) throw badRequest('Enter the amount', 'amount')
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Expense amount must be a positive number', 'amount')
  if (amount > 1_000_000_000) throw badRequest('That amount is too large', 'amount')

  let category = null
  const categoryId = Number.parseInt(pick('category_id', existing?.category_id ?? ''), 10)
  if (Number.isInteger(categoryId) && categoryId > 0) {
    const [rows] = await db.execute('SELECT id, name FROM expense_categories WHERE id = ? LIMIT 1', [categoryId])
    if (!rows[0]) throw badRequest('That category no longer exists', 'category')
    category = rows[0]
  } else if (cleanText(payload.category, 60)) {
    // Older clients send the category name.
    const raw = cleanText(payload.category, 60)
    category = await findOrCreateCategory(db, LEGACY_CATEGORY_NAMES[raw.toLowerCase()] || raw)
  }
  if (!category) throw badRequest('Expense category is required', 'category')

  // Older clients send only paid_from; "bank" then means a bank transfer.
  const legacyMethod = String(payload.paid_from ?? '').trim().toLowerCase() === 'bank' ? 'bank_transfer' : 'cash'
  const method = String(pick('method', existing?.method ?? legacyMethod)).trim().toLowerCase()
  if (!EXPENSE_METHODS.includes(method)) throw badRequest(`method must be one of: ${EXPENSE_METHODS.join(', ')}`, 'method')
  // Cash comes from the till or the owner; anything else is paid from the bank.
  const paidFrom = method === 'cash'
    ? (() => {
        const source = normalizePaidFrom(pick('paid_from', existing?.paid_from))
        return source === 'bank' ? DEFAULT_PAID_FROM : source
      })()
    : 'bank'

  const status = String(pick('status', existing?.status ?? 'paid')).trim().toLowerCase()
  if (!EXPENSE_STATUSES.includes(status)) throw badRequest('status must be paid or unpaid', 'status')

  const title = cleanText(pick('title', existing?.title ?? ''), TITLE_MAX)
  const vendor = cleanText(pick('vendor', existing?.vendor ?? ''), VENDOR_MAX)
  const note = String(pick('note', pick('description', existing?.note ?? '')) ?? '').trim().slice(0, NOTE_MAX)

  // receipt: a file name from the receipt upload; null/'' removes it; left out keeps the current one.
  let receiptFile = existing ? existing.receipt_file ?? null : null
  if (payload.receipt !== undefined) {
    const value = payload.receipt == null ? '' : String(payload.receipt).trim()
    if (!value) {
      receiptFile = null
    } else if (value !== receiptFile) {
      if (!RECEIPT_FILE_PATTERN.test(value) || !receiptsDir || !fs.existsSync(path.join(receiptsDir, value))) {
        throw badRequest('Upload the receipt photo again', 'receipt')
      }
      receiptFile = value
    }
  }

  const rawRecurring = pick('is_recurring', existing?.is_recurring ?? false)
  const isRecurring = rawRecurring === true || rawRecurring === 1 || rawRecurring === '1' || rawRecurring === 'true'

  return {
    expenseDate,
    amount: Math.round(amount * 100) / 100,
    category,
    method,
    paidFrom,
    status,
    title: title || null,
    vendor: vendor || null,
    note: note || null,
    receiptFile,
    isRecurring,
  }
}

async function createExpense(db, payload, user, { receiptsDir = null } = {}) {
  await ensureExpensesSchema(db)
  const input = await normalizeExpenseInput(db, payload ?? {}, { receiptsDir })
  const [result] = await db.execute(
    `
    INSERT INTO expenses
      (category, category_id, description, vendor, amount, method, status, paid_from, receipt_file,
       is_recurring, recurring_last_month, paid_at, expense_date, created_by, created_by_name, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${input.status === 'paid' ? 'NOW()' : 'NULL'}, ?, ?, ?, ?)
    `,
    [
      input.category.name,
      input.category.id,
      input.note,
      input.vendor,
      input.amount,
      input.method,
      input.status,
      input.paidFrom,
      input.receiptFile,
      input.isRecurring ? 1 : 0,
      input.isRecurring ? monthOf(input.expenseDate) : null,
      input.expenseDate,
      user?.id || null,
      user?.display_name || user?.username || null,
      input.title,
    ],
  )
  return getExpense(db, result.insertId)
}

function parseExpenseId(expenseId) {
  const id = Number.parseInt(expenseId, 10)
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid expense id'), { status: 400 })
  return id
}

async function loadStoredExpense(db, id) {
  const [rows] = await db.execute(
    `SELECT e.*, DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date_key FROM expenses e WHERE e.id = ? LIMIT 1`,
    [id],
  )
  if (!rows[0]) throw Object.assign(new Error('Expense not found'), { status: 404 })
  const row = rows[0]
  return {
    ...serializeExpense({ ...row, expense_date: row.expense_date_key }),
    receipt_file: row.receipt_file || null,
  }
}

/**
 * Edits an expense; returns { expense, previous, removedReceipt } (the receipt file it no longer uses).
 * Turning "Repeat monthly" off on any expense of a series stops the series; turning it on makes
 * this expense the start of a new one.
 */
async function updateExpense(db, expenseId, payload, { receiptsDir = null } = {}) {
  await ensureExpensesSchema(db)
  const id = parseExpenseId(expenseId)
  const previous = await loadStoredExpense(db, id)
  const input = await normalizeExpenseInput(db, payload ?? {}, { existing: previous, receiptsDir })

  const paidAtSql = input.status === 'paid'
    ? (previous.status === 'paid' ? 'paid_at' : 'NOW()')
    : 'NULL'
  let parentId = previous.recurring_parent_id
  let startMonth = null
  if (!input.isRecurring && previous.is_recurring) {
    // Stops the whole series: no more copies, and its rows lose the repeat icon.
    const rootId = previous.recurring_parent_id ?? id
    await db.execute('UPDATE expenses SET is_recurring = 0 WHERE id = ? OR recurring_parent_id = ?', [rootId, rootId])
  } else if (input.isRecurring && !previous.is_recurring) {
    parentId = null
    startMonth = monthOf(input.expenseDate)
  }

  await db.execute(
    `
    UPDATE expenses
    SET category = ?, category_id = ?, description = ?, vendor = ?, amount = ?, method = ?, status = ?,
        paid_from = ?, receipt_file = ?, is_recurring = ?, recurring_parent_id = ?,
        recurring_last_month = COALESCE(?, recurring_last_month), paid_at = ${paidAtSql}, expense_date = ?,
        title = ?, updated_at = NOW()
    WHERE id = ?
    `,
    [
      input.category.name,
      input.category.id,
      input.note,
      input.vendor,
      input.amount,
      input.method,
      input.status,
      input.paidFrom,
      input.receiptFile,
      input.isRecurring ? 1 : 0,
      parentId,
      startMonth,
      input.expenseDate,
      input.title,
      id,
    ],
  )
  const removedReceipt = previous.receipt_file && previous.receipt_file !== input.receiptFile ? previous.receipt_file : null
  return { expense: await getExpense(db, id), previous, removedReceipt }
}

/** Deletes an expense; returns the receipt file name it used (for the caller to remove), or null. */
async function deleteExpense(db, expenseId) {
  await ensureExpensesSchema(db)
  const id = parseExpenseId(expenseId)
  const [rows] = await db.execute('SELECT receipt_file FROM expenses WHERE id = ? LIMIT 1', [id])
  const [result] = await db.execute('DELETE FROM expenses WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw Object.assign(new Error('Expense not found'), { status: 404 })
  }
  return rows[0]?.receipt_file || null
}

/** Absolute path of an expense's receipt photo, or null. */
async function expenseReceiptPath(db, expenseId, receiptsDir) {
  await ensureExpensesSchema(db)
  const id = parseExpenseId(expenseId)
  const [rows] = await db.execute('SELECT receipt_file FROM expenses WHERE id = ? LIMIT 1', [id])
  const file = rows[0]?.receipt_file
  if (!file || !RECEIPT_FILE_PATTERN.test(file)) return null
  const fullPath = path.join(receiptsDir, file)
  return fs.existsSync(fullPath) ? fullPath : null
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
  EXPENSE_METHODS,
  EXPENSE_STATUSES,
  DEFAULT_EXPENSE_CATEGORIES,
  RECEIPT_FILE_PATTERN,
  normalizePaidFrom,
  ensureExpensesSchema,
  listExpenseCategories,
  listExpenses,
  expenseOverview,
  materializeRecurringExpenses,
  normalizeExpenseInput,
  createExpense,
  updateExpense,
  deleteExpense,
  expenseReceiptPath,
  summarizeExpensesToday,
  serializeExpense,
}
