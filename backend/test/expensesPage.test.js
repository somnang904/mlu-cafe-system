const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { normalizeExpenseInput, materializeRecurringExpenses } = require('../src/utils/expenses')
const { parseExpenseFilters } = require('../src/utils/expenseExport')

// Categories table only (normalizeExpenseInput looks categories up by id or name).
function categoryDb(categories = [{ id: 1, name: 'Ingredients' }, { id: 4, name: 'Utilities' }]) {
  const rows = [...categories]
  return {
    rows,
    async execute(sql, params = []) {
      if (/FROM expense_categories WHERE id = \?/.test(sql)) return [rows.filter((row) => row.id === params[0])]
      if (/FROM expense_categories WHERE LOWER\(name\)/.test(sql)) {
        return [rows.filter((row) => row.name.toLowerCase() === String(params[0]).toLowerCase())]
      }
      if (/SELECT COUNT\(\*\) AS count FROM expense_categories/.test(sql)) return [[{ count: rows.length }]]
      if (/INSERT INTO expense_categories/.test(sql)) {
        rows.push({ id: rows.length + 10, name: params[0] })
        return [{ insertId: rows.length + 9 }]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
}

const valid = { expense_date: '2026-10-05', amount: '12.50', category_id: 4 }

test('date, amount and category are required, each reported on its field', async () => {
  const db = categoryDb()
  const cases = [
    [{ ...valid, expense_date: '2026-02-30' }, 'date'],
    [{ ...valid, amount: '' }, 'amount'],
    [{ ...valid, amount: '-3' }, 'amount'],
    [{ ...valid, category_id: undefined }, 'category'],
    [{ ...valid, category_id: 99 }, 'category'],
    [{ ...valid, method: 'cheque' }, 'method'],
    [{ ...valid, status: 'maybe' }, 'status'],
  ]
  for (const [payload, field] of cases) {
    await assert.rejects(normalizeExpenseInput(db, payload), (error) => error.status === 400 && error.field === field)
  }
  // Editing keeps the stored date when the form doesn't send one; adding defaults to today.
  await assert.rejects(
    normalizeExpenseInput(db, { ...valid, expense_date: '' }, { existing: { expense_date: '' } }),
    (error) => error.field === 'date',
  )
})

test('cash is paid from the drawer or the owner; other methods from the bank', async () => {
  const db = categoryDb()
  assert.equal((await normalizeExpenseInput(db, { ...valid, method: 'cash', paid_from: 'owner' })).paidFrom, 'owner')
  assert.equal((await normalizeExpenseInput(db, { ...valid, method: 'cash', paid_from: 'bank' })).paidFrom, 'drawer')
  assert.equal((await normalizeExpenseInput(db, { ...valid, method: 'aba_khqr', paid_from: 'drawer' })).paidFrom, 'bank')
  const input = await normalizeExpenseInput(db, { ...valid, vendor: '  Lucky   Market ', note: 'Rice', is_recurring: true, status: 'unpaid' })
  assert.deepEqual(
    [input.amount, input.category.name, input.vendor, input.note, input.isRecurring, input.status],
    [12.5, 'Utilities', 'Lucky Market', 'Rice', true, 'unpaid'],
  )
})

test('old category names map to the new defaults', async () => {
  const db = categoryDb()
  const input = await normalizeExpenseInput(db, { expense_date: '2026-10-05', amount: 5, category: 'Inventory Restock' })
  assert.equal(input.category.name, 'Ingredients')
})

test('a receipt must be a stored upload; null removes it, leaving it out keeps it', async () => {
  const db = categoryDb()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-'))
  fs.writeFileSync(path.join(dir, 'bill-1-abc.webp'), 'x')
  const existing = { expense_date: '2026-10-05', amount: 5, category_id: 4, receipt_file: 'old-1.webp' }
  assert.equal((await normalizeExpenseInput(db, { ...valid, receipt: 'bill-1-abc.webp' }, { receiptsDir: dir })).receiptFile, 'bill-1-abc.webp')
  assert.equal((await normalizeExpenseInput(db, { amount: 6 }, { existing, receiptsDir: dir })).receiptFile, 'old-1.webp')
  assert.equal((await normalizeExpenseInput(db, { receipt: null }, { existing, receiptsDir: dir })).receiptFile, null)
  for (const receipt of ['../secret.webp', 'missing.webp', 'bill.exe']) {
    await assert.rejects(
      normalizeExpenseInput(db, { ...valid, receipt }, { receiptsDir: dir }),
      (error) => error.field === 'receipt',
    )
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

// Just enough of the expenses table for materializeRecurringExpenses.
function seriesDb(rows) {
  const table = rows.map((row) => ({ recurring_last_month: null, recurring_parent_id: null, ...row }))
  const lastMonth = (row) => row.recurring_last_month || row.expense_date.slice(0, 7)
  return {
    table,
    async execute(sql, params = []) {
      if (/FROM expenses\s+WHERE is_recurring = 1 AND recurring_parent_id IS NULL/.test(sql)) {
        return [table.filter((row) => row.is_recurring && row.recurring_parent_id == null).map((row) => ({ ...row, last_month: lastMonth(row) }))]
      }
      if (/UPDATE expenses SET recurring_last_month = \?/.test(sql)) {
        const [month, id, expected] = params
        const row = table.find((entry) => entry.id === id)
        if (!row || !row.is_recurring || lastMonth(row) !== expected) return [{ affectedRows: 0 }]
        row.recurring_last_month = month
        return [{ affectedRows: 1 }]
      }
      if (/INSERT INTO expenses/.test(sql)) {
        table.push({ id: table.length + 100, status: 'unpaid', amount: params[4], expense_date: params[7], recurring_parent_id: params[8], is_recurring: 1 })
        return [{ insertId: table.length + 99 }]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
}

test('repeat monthly adds each missing month once, on the same day (clamped), as unpaid', async () => {
  const db = seriesDb([
    { id: 1, amount: '300.00', expense_date: '2026-07-31', is_recurring: 1 },
    { id: 2, amount: '20.00', expense_date: '2026-09-10', is_recurring: 0 },
  ])
  const now = new Date(2026, 9, 6)
  assert.equal(await materializeRecurringExpenses(db, now), 3)
  const copies = db.table.filter((row) => row.recurring_parent_id === 1)
  assert.deepEqual(copies.map((row) => row.expense_date), ['2026-08-31', '2026-09-30', '2026-10-31'])
  assert.ok(copies.every((row) => row.status === 'unpaid'))
  // Running again (or from a second request) adds nothing.
  assert.equal(await materializeRecurringExpenses(db, now), 0)
  // A deleted copy is not added back.
  db.table.splice(db.table.findIndex((row) => row.expense_date === '2026-10-31'), 1)
  assert.equal(await materializeRecurringExpenses(db, now), 0)
  // Next month: one more.
  assert.equal(await materializeRecurringExpenses(db, new Date(2026, 10, 2)), 1)
})

test('a stopped series adds nothing', async () => {
  const db = seriesDb([{ id: 1, amount: '50.00', expense_date: '2026-01-15', is_recurring: 0 }])
  assert.equal(await materializeRecurringExpenses(db, new Date(2026, 9, 6)), 0)
})

test('expense export filters: period required, unknown filters ignored', () => {
  const filters = parseExpenseFilters({ from: '2026-10-01', to: '2026-10-06', category_id: '4', method: 'card', status: 'nope', search: ' Rice ' })
  assert.deepEqual(
    [filters.period.startDate, filters.categoryId, filters.method, filters.status, filters.search],
    ['2026-10-01', 4, 'card', null, 'rice'],
  )
  assert.throws(() => parseExpenseFilters({}), /Invalid date range/)
})

test('expense export: period=all has no date range; from/to still wins', () => {
  assert.equal(parseExpenseFilters({ period: 'all' }).period.scope, 'all')
  assert.equal(parseExpenseFilters({ period: 'all' }).period.startDate, null)
  assert.equal(parseExpenseFilters({ period: 'all', from: '2026-10-01', to: '2026-10-06' }).period.scope, 'range')
})

test('title is optional, trimmed, and kept when an edit leaves it out', async () => {
  const db = categoryDb()
  assert.equal((await normalizeExpenseInput(db, { ...valid, title: '  Buy   vegetables ' })).title, 'Buy vegetables')
  assert.equal((await normalizeExpenseInput(db, valid)).title, null)
  const existing = { expense_date: '2026-10-05', amount: 5, category_id: 4, title: 'Rent October' }
  assert.equal((await normalizeExpenseInput(db, { amount: 6 }, { existing })).title, 'Rent October')
})
