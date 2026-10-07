const test = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { formatMoney, parseReportMonth, parseReportSections } = require('../src/utils/exportParams')
const { buildSalesPdfBuffer } = require('../src/utils/salesPdf')
const { buildReportPdfBuffer, buildReportWorkbook } = require('../src/utils/reportExport')

test('report month accepts YYYY-MM and all, and rejects junk', () => {
  assert.equal(parseReportMonth('all').scope, 'all')
  assert.equal(parseReportMonth('2026-09').fileKey, '2026-09')
  assert.equal(parseReportMonth('2026-09').startDate, '2026-09-01')
  assert.equal(parseReportMonth('2026-09').endDate, '2026-10-01')
  assert.throws(() => parseReportMonth('2026-13'), /Invalid month/)
  assert.throws(() => parseReportMonth('September'), /Invalid month/)
  assert.throws(() => parseReportMonth(''), /Invalid month/)
})

test('money puts the minus sign before the dollar sign', () => {
  assert.equal(formatMoney(-12.5), '-$12.50')
  assert.equal(formatMoney(1234.5), '$1,234.50')
  assert.equal(formatMoney(0), '$0.00')
})

test('report sections require a known selection', () => {
  assert.deepEqual(parseReportSections('spending,income,income'), ['income', 'spending'])
  assert.throws(() => parseReportSections(''), /at least one/)
  assert.throws(() => parseReportSections('payroll'), /Invalid report section/)
})

test('sales PDF is a real PDF buffer', async () => {
  const buffer = await buildSalesPdfBuffer({
    period: { scope: 'all', label: 'All Time' },
    generatedBy: 'admin',
    summary: {
      months: [{ monthKey: '2026-09', orders: 2, gross: 10, cash: 4, bank: 6, other: 0 }],
      totals: { orders: 2, gross: 10, cash: 4, bank: 6, other: 0 },
    },
  })
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
})

test('report workbook keeps numbers and only selected sheets', async () => {
  const data = {
    period: { scope: 'month', label: 'September 2026', fileKey: '2026-09' },
    summary: { revenue: 12.5, expenses: 2, profit: 10.5, orders: 3 },
    breakdownLabel: 'Daily breakdown',
    breakdown: [{ label: '2026-09-01', orders: 3, revenue: 12.5, expenses: 2, profit: 10.5 }],
    spending: [{ category: 'Payroll', amount: 2 }],
  }
  const raw = await buildReportWorkbook(data, ['income', 'monthly'])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(raw)
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'Daily'])
  const income = workbook.getWorksheet('Summary').getRow(2)
  assert.equal(income.getCell(1).value, 'Sales')
  assert.equal(income.getCell(2).value, 12.5)
  assert.equal(income.getCell(2).numFmt, '$#,##0.00')

  const pdf = await buildReportPdfBuffer(data, ['spending'], 'admin')
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})

test('report workbook shows sales, refunds and net', async () => {
  const data = {
    period: { scope: 'month', label: 'October 2026', fileKey: '2026-10' },
    summary: {
      revenue: 5000,
      refunds: 12.5,
      net: 4987.5,
      expenses: 100,
      profit: 4887.5,
      orders: 40,
      refundOrders: 1,
    },
    breakdownLabel: 'Daily breakdown',
    breakdown: [{
      label: '2026-10-03',
      orders: 4,
      revenue: 50,
      refundOrders: 1,
      refunds: 12.5,
      net: 37.5,
      expenses: 0,
      profit: 37.5,
    }],
    spending: [],
  }
  const raw = await buildReportWorkbook(data, ['income', 'profit', 'orders', 'monthly'])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(raw)
  const summary = workbook.getWorksheet('Summary')
  const values = []
  summary.eachRow((row, rowNumber) => {
    if (rowNumber > 1) values.push([row.getCell(1).value, row.getCell(2).value, row.getCell(2).numFmt])
  })
  assert.deepEqual(values, [
    ['Sales', 5000, '$#,##0.00'],
    ['Refunds', -12.5, '$#,##0.00'],
    ['Net sales', 4987.5, '$#,##0.00'],
    ['Net profit', 4887.5, '$#,##0.00'],
    ['Orders fulfilled', 40, '#,##0'],
    ['Orders refunded', 1, '#,##0'],
  ])

  const daily = workbook.getWorksheet('Daily')
  assert.deepEqual(daily.getRow(1).values.slice(1), [
    'Period', 'Orders', 'Sales', 'Refunds', 'Net sales', 'Expenses', 'Net profit',
  ])
  assert.deepEqual(daily.getRow(2).values.slice(1), ['2026-10-03', 4, 50, -12.5, 37.5, 0, 37.5])

  const pdf = await buildReportPdfBuffer(data, ['income', 'orders', 'monthly'], 'admin')
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})

test('sales PDF lists refunds made in the month', async () => {
  const buffer = await buildSalesPdfBuffer({
    period: { scope: 'month', label: 'October 2026' },
    generatedBy: 'admin',
    monthData: {
      lines: [{ orderId: 'INV-2', source: 'Take Out', soldAt: '2026-10-02 10:00 AM', payment: 'Cash', total: 20, status: 'Completed' }],
      refunds: [{ orderId: 'INV-1', soldAt: '2026-09-28 09:00 AM', refundedAt: '2026-10-03 11:00 AM', payment: 'Cash', total: 12.5 }],
      totals: { orders: 1, gross: 20, refundOrders: 1, refunds: 12.5, net: 7.5, cash: 7.5, bank: 0, other: 0 },
    },
    summary: null,
  })
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
})

test('report period takes from/to before month and labels whole months by name', () => {
  const { parseReportPeriod } = require('../src/utils/exportParams')
  const range = parseReportPeriod({ from: '2026-10-01', to: '2026-10-06', month: '2026-09' })
  assert.equal(range.scope, 'range')
  assert.equal(range.startDate, '2026-10-01')
  assert.equal(range.endDate, '2026-10-07')
  assert.equal(range.label, '1 Oct 2026 - 6 Oct 2026')
  assert.equal(parseReportPeriod({ from: '2026-09-01', to: '2026-09-30' }).label, 'September 2026')
  assert.equal(parseReportPeriod({ month: '2026-09' }).scope, 'month')
  assert.throws(() => parseReportPeriod({ from: '2026-10-06', to: '2026-10-01' }), /on or before/)
  assert.throws(() => parseReportPeriod({ from: '2026-02-30', to: '2026-03-01' }), /Invalid date range/)
  assert.throws(() => parseReportPeriod({ from: '2020-01-01', to: '2026-01-01' }), /two years/)
})

test('previous period: same days last month from the 1st, otherwise the days just before', () => {
  const { parseReportPeriod, previousPeriod } = require('../src/utils/exportParams')
  const prev = (from, to) => {
    const period = previousPeriod(parseReportPeriod({ from, to }))
    return [period.startDate, period.endDate]
  }
  // This month so far → same days last month.
  assert.deepEqual(prev('2026-10-01', '2026-10-06'), ['2026-09-01', '2026-09-07'])
  // A whole month → the whole previous month (31 → 30 days, and across a year).
  assert.deepEqual(prev('2026-10-01', '2026-10-31'), ['2026-09-01', '2026-10-01'])
  assert.deepEqual(prev('2026-01-01', '2026-01-31'), ['2025-12-01', '2026-01-01'])
  // 31st clamps to a shorter month.
  assert.deepEqual(prev('2026-03-01', '2026-03-30'), ['2026-02-01', '2026-03-01'])
  // Last 7 days → the 7 days before.
  assert.deepEqual(prev('2026-09-30', '2026-10-06'), ['2026-09-23', '2026-09-30'])
  assert.deepEqual(previousPeriod(parseReportPeriod({ month: '2026-09' })).label, 'August 2026')
  assert.equal(previousPeriod({ scope: 'all' }), null)
})

test('report with compare adds previous and change columns', async () => {
  const data = {
    period: { scope: 'range', label: 'October 2026' },
    summary: { revenue: 120, refunds: 0, net: 120, expenses: 30, profit: 90, orders: 6, refundOrders: 0 },
    previous: {
      period: { label: 'September 2026' },
      summary: { revenue: 100, refunds: 0, net: 100, expenses: 0, profit: 100, orders: 5, refundOrders: 0 },
    },
    breakdown: [],
    breakdownLabel: 'Daily breakdown',
    spending: [],
  }
  const buffer = await buildReportWorkbook(data, ['income', 'expenses'])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Summary')
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Metric', 'October 2026', 'Previous (September 2026)', 'Change'])
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['Sales', 120, 100, '+20.0%'])
  // No base to compare with.
  assert.equal(sheet.getRow(5).getCell(4).value, 'n/a')
  const pdf = await buildReportPdfBuffer(data, ['income', 'expenses'], 'admin')
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})

test('report "all" covers all time: no date filter, months from the first sale or expense', async () => {
  const { loadReportData } = require('../src/utils/reportExport')
  const calls = []
  const db = {
    async execute(sql, params = []) {
      calls.push({ sql, params })
      if (/FROM orders/.test(sql)) {
        return [/updated_at, '%Y-%m'/.test(sql) ? [{ bucket: '2023-02', orders: 1, amount: 10 }] : []]
      }
      // Expenses: schema checks, category links, repeats and the list itself.
      if (/information_schema\.COLUMNS/.test(sql)) return [[{ 1: 1 }]]
      if (/SELECT DISTINCT category/.test(sql) || /WHERE is_recurring = 1 AND recurring_parent_id IS NULL/.test(sql)) return [[]]
      if (/FROM expenses e/.test(sql)) return [[]]
      return [{}]
    },
  }
  const data = await loadReportData(db, parseReportMonth('all'))
  const orderQueries = calls.filter((call) => /FROM orders/.test(call.sql))
  assert.ok(orderQueries.every((call) => /1 = 1/.test(call.sql) && call.params.length === 0))
  assert.equal(data.breakdown[0].label, 'February 2023')
  assert.equal(data.summary.revenue, 10)
  assert.equal(parseReportMonth('all').label, 'All time')
})
