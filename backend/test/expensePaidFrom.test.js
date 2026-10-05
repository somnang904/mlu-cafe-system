const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PAID_FROM_VALUES,
  normalizePaidFrom,
  serializeExpense,
  createExpense,
} = require('../src/utils/expenses')
const { getLiveShiftMetrics, expectedDrawerUsd } = require('../src/utils/shifts')

function fakeDb(handler) {
  const calls = []
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params })
      if (/information_schema\.COLUMNS/.test(sql)) return [[{ 1: 1 }]]
      if (/^\s*CREATE TABLE/i.test(sql)) return [{}]
      return handler(sql, params)
    },
  }
}

test('paid_from defaults to the cash drawer', () => {
  assert.equal(normalizePaidFrom(undefined), 'drawer')
  assert.equal(normalizePaidFrom(null), 'drawer')
  assert.equal(normalizePaidFrom(''), 'drawer')
  assert.equal(normalizePaidFrom('   '), 'drawer')
})

test('paid_from accepts the three sources, ignoring case and spaces', () => {
  assert.deepEqual(PAID_FROM_VALUES, ['drawer', 'bank', 'owner'])
  assert.equal(normalizePaidFrom('drawer'), 'drawer')
  assert.equal(normalizePaidFrom(' Bank '), 'bank')
  assert.equal(normalizePaidFrom('OWNER'), 'owner')
})

test('unknown paid_from values are rejected with 400', () => {
  for (const value of ['cash', 'aba', 'till', 0, 1, true, {}]) {
    assert.throws(() => normalizePaidFrom(value), (error) => error.status === 400 && /paid_from/.test(error.message))
  }
})

test('rows saved before the column existed read back as drawer', () => {
  const base = { id: 1, category: 'Supplies', amount: '3.50', expense_date: '2026-10-01' }
  assert.equal(serializeExpense(base).paid_from, 'drawer')
  assert.equal(serializeExpense({ ...base, paid_from: 'owner' }).paid_from, 'owner')
})

test('createExpense stores the chosen source and refuses bad ones before writing', async () => {
  const db = fakeDb((sql, params) => {
    if (/^\s*INSERT INTO expenses/.test(sql)) return [{ insertId: 9 }]
    if (/SELECT \* FROM expenses/.test(sql)) {
      return [[{ id: 9, category: 'Utilities', amount: '40.00', paid_from: 'bank', expense_date: '2026-10-05' }]]
    }
    throw new Error(`unexpected query ${sql} ${params}`)
  })
  const saved = await createExpense(db, { category: 'Utilities', amount: 40, paid_from: 'bank', expense_date: '2026-10-05' })
  assert.equal(saved.paid_from, 'bank')
  const insert = db.calls.find((call) => /INSERT INTO expenses/.test(call.sql))
  assert.match(insert.sql, /paid_from/)
  assert.ok(insert.params.includes('bank'))

  const before = db.calls.length
  await assert.rejects(
    createExpense(db, { category: 'Utilities', amount: 40, paid_from: 'cash' }),
    (error) => error.status === 400,
  )
  assert.equal(db.calls.slice(before).some((call) => /INSERT/.test(call.sql)), false)
})

test('shift metrics only count cash-drawer expenses', async () => {
  const db = fakeDb((sql) => {
    if (/FROM expenses/.test(sql)) return [[{ total_expenses: '7.25' }]]
    if (/COUNT\(\*\)/.test(sql)) return [[{ order_count: 0 }]]
    if (/SUM\(total\)/.test(sql)) return [[{ total_usd: 0 }]]
    return [[]]
  })
  const metrics = await getLiveShiftMetrics(db, '2026-10-05 08:00:00', '2026-10-05 18:00:00')
  const expenseQuery = db.calls.find((call) => /FROM expenses/.test(call.sql) && /SUM\(amount\)/.test(call.sql))
  assert.match(expenseQuery.sql, /paid_from = 'drawer'/)
  assert.deepEqual(expenseQuery.params, ['2026-10-05 08:00:00', '2026-10-05 18:00:00'])
  assert.equal(metrics.expensesUsd, 7.25)
  assert.equal(expectedDrawerUsd(50, metrics), 42.75)
})
