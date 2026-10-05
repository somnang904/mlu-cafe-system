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
