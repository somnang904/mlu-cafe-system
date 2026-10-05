const ExcelJS = require('exceljs')
const {
  actorLabel,
  formatMoney,
  parseReportMonth,
  parseReportSections,
  reportFilename,
  roundMoney,
} = require('./exportParams')
const {
  drawDocumentHeader,
  drawNote,
  drawSectionTitle,
  drawTable,
  renderPdf,
} = require('./pdfLayout')

const {
  formatRefundMoney,
  mergeSalesAndRefunds,
  refundDateSql,
  refundedStatusSql,
  saleStatusSql,
  salesAndRefunds,
} = require('./salesTotals')

const HISTORY_DAYS = 730
const MONTH_LOOKBACK = 16
const SOLD = saleStatusSql()
const REFUNDED = refundedStatusSql()
const REFUND_DATE = refundDateSql()
const TOTAL_SQL = `COALESCE(total, total_amount, 0)`
const EMPTY_TOTALS = salesAndRefunds()
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-')
  const name = MONTH_NAMES[Number(month) - 1]
  return name ? `${name} ${year}` : String(monthKey || '')
}

function lastMonthKeys(count, now = new Date()) {
  const keys = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function daysInMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

function rangeSql(dateSql, period) {
  if (period.scope === 'month') {
    return { sql: `${dateSql} >= ? AND ${dateSql} < ?`, params: [period.startDate, period.endDate] }
  }
  return { sql: `${dateSql} >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`, params: [HISTORY_DAYS] }
}

async function bucketRows(db, statusSql, dateSql, period, grain) {
  const format = grain === 'day' ? '%Y-%m-%d' : '%Y-%m'
  const range = rangeSql(dateSql, period)
  const [rows] = await db.execute(
    `
    SELECT
      DATE_FORMAT(${dateSql}, '${format}') AS bucket,
      COUNT(*) AS orders,
      COALESCE(SUM(${TOTAL_SQL}), 0) AS amount
    FROM orders
    WHERE ${statusSql} AND ${range.sql}
    GROUP BY DATE_FORMAT(${dateSql}, '${format}')
    `,
    range.params,
  )
  return rows
}

async function salesBuckets(db, period, grain) {
  const sales = await bucketRows(db, SOLD, 'updated_at', period, grain)
  const refunds = await bucketRows(db, REFUNDED, REFUND_DATE, period, grain)
  return mergeSalesAndRefunds(sales, refunds)
}

function sumBuckets(buckets) {
  const total = { orders: 0, sales: 0, refundOrders: 0, refunds: 0 }
  for (const bucket of buckets.values()) {
    total.orders += bucket.orders
    total.sales += bucket.sales
    total.refundOrders += bucket.refundOrders
    total.refunds += bucket.refunds
  }
  return salesAndRefunds(total)
}

function breakdownRow(label, sales, expensesTotal) {
  return {
    label,
    orders: sales.orders,
    revenue: sales.sales,
    refundOrders: sales.refundOrders,
    refunds: sales.refunds,
    net: sales.net,
    expenses: expensesTotal,
    profit: roundMoney(sales.net - expensesTotal),
  }
}

function reportSummary(sales, spending) {
  return {
    revenue: sales.sales,
    refunds: sales.refunds,
    net: sales.net,
    expenses: spending,
    profit: roundMoney(sales.net - spending),
    orders: sales.orders,
    refundOrders: sales.refundOrders,
  }
}

function expenseMap(expenses, grain) {
  const map = new Map()
  for (const expense of expenses) {
    const key = String(expense.expense_date || '').slice(0, grain === 'day' ? 10 : 7)
    if (!key) continue
    const current = map.get(key) || { amount: 0 }
    current.amount = roundMoney(current.amount + Number(expense.amount || 0))
    map.set(key, current)
  }
  return map
}

function categoryTotals(expenses) {
  const totals = new Map()
  for (const expense of expenses) {
    const category = expense.category || 'Others'
    totals.set(category, roundMoney((totals.get(category) || 0) + Number(expense.amount || 0)))
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))
}

async function loadExpensesInScope(db, period) {
  const { listExpenses } = require('./expenses')
  const expenses = await listExpenses(db, { days: HISTORY_DAYS })
  if (period.scope !== 'month') return expenses
  return expenses.filter((expense) => String(expense.expense_date || '').startsWith(period.fileKey))
}

async function loadReportData(db, period) {
  if (period.scope === 'month') {
    const salesByDay = await salesBuckets(db, period, 'day')
    const summary = sumBuckets(salesByDay)
    const expenses = await loadExpensesInScope(db, period)
    const spending = roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))
    const spendByDay = expenseMap(expenses, 'day')
    const breakdown = Array.from({ length: daysInMonth(period.fileKey) }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      const key = `${period.fileKey}-${day}`
      return breakdownRow(key, salesByDay.get(key) || EMPTY_TOTALS, spendByDay.get(key)?.amount || 0)
    })
    return {
      period,
      summary: reportSummary(summary, spending),
      breakdown,
      breakdownLabel: 'Daily breakdown',
      spending: categoryTotals(expenses),
    }
  }

  const salesByMonth = await salesBuckets(db, period, 'month')
  const summary = sumBuckets(salesByMonth)
  const expenses = await loadExpensesInScope(db, period)
  const spending = roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))
  const spendByMonth = expenseMap(expenses, 'month')
  const breakdown = lastMonthKeys(MONTH_LOOKBACK)
    .map((key) => breakdownRow(
      monthLabel(key),
      salesByMonth.get(key) || EMPTY_TOTALS,
      spendByMonth.get(key)?.amount || 0,
    ))
    .filter((row) => row.revenue > 0 || row.refunds > 0 || row.expenses > 0)

  return {
    period,
    summary: reportSummary(summary, spending),
    breakdown,
    breakdownLabel: 'Monthly breakdown',
    spending: categoryTotals(expenses),
  }
}

const COUNT_METRICS = new Set(['Orders fulfilled', 'Orders refunded'])

function negative(value) {
  const amount = roundMoney(value)
  return amount ? -amount : 0
}

function netOf(row) {
  return row.net ?? roundMoney((row.revenue || 0) - (row.refunds || 0))
}

function summaryRows(data, sections) {
  const { summary } = data
  const rows = []
  if (sections.includes('income')) {
    rows.push(['Sales', summary.revenue])
    rows.push(['Refunds', negative(summary.refunds)])
    rows.push(['Net sales', netOf(summary)])
  }
  if (sections.includes('expenses')) rows.push(['Expenses', summary.expenses])
  if (sections.includes('profit')) rows.push(['Net profit', summary.profit])
  if (sections.includes('orders')) {
    rows.push(['Orders fulfilled', summary.orders])
    rows.push(['Orders refunded', summary.refundOrders || 0])
  }
  return rows
}

function breakdownValues(row) {
  return [
    row.label,
    row.orders,
    row.revenue,
    negative(row.refunds),
    netOf(row),
    row.expenses,
    row.profit,
  ]
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FF064E3B' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
  row.alignment = { vertical: 'middle' }
}

function fitColumns(sheet) {
  sheet.columns.forEach((column) => {
    let width = 12
    column.eachCell({ includeEmpty: false }, (cell) => {
      const length = String(cell.value ?? '').length + 2
      if (length > width) width = length
    })
    column.width = Math.min(width, 42)
  })
}

function addSheet(workbook, name, headers, rows, moneyIndexes) {
  const sheet = workbook.addWorksheet(name)
  styleHeader(sheet.addRow(headers))
  for (const values of rows) {
    const row = sheet.addRow(values)
    moneyIndexes.forEach((index) => {
      const cell = row.getCell(index)
      if (typeof cell.value === 'number') cell.numFmt = '$#,##0.00'
    })
  }
  fitColumns(sheet)
  return sheet
}

async function buildReportWorkbook(data, sections) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Mlu Kitchen & Cafe Siem Reap'
  const summary = summaryRows(data, sections)
  if (summary.length) {
    const sheet = addSheet(workbook, 'Summary', ['Metric', 'Value'], summary, [])
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const metric = row.getCell(1).value
      const cell = row.getCell(2)
      if (COUNT_METRICS.has(metric)) {
        cell.numFmt = '#,##0'
      } else if (typeof cell.value === 'number') {
        cell.numFmt = '$#,##0.00'
      }
    })
  }
  if (sections.includes('monthly')) {
    addSheet(
      workbook,
      data.period.scope === 'month' ? 'Daily' : 'Monthly',
      ['Period', 'Orders', 'Sales', 'Refunds', 'Net sales', 'Expenses', 'Net profit'],
      data.breakdown.map(breakdownValues),
      [3, 4, 5, 6, 7],
    )
  }
  if (sections.includes('spending')) {
    addSheet(
      workbook,
      'Spending by category',
      ['Category', 'Amount'],
      data.spending.map((row) => [row.category, row.amount]),
      [2],
    )
  }
  return workbook.xlsx.writeBuffer()
}

function buildReportPdfBuffer(data, sections, generatedBy) {
  return renderPdf((doc) => {
    doc.info.Title = 'Business report'
    doc.info.Author = generatedBy
    let y = drawDocumentHeader(doc, {
      title: 'Business report',
      periodLabel: data.period.label,
      generatedBy,
    })
    y = drawNote(doc, y, 'Figures follow the Reports page. The chart is shown as a table.')

    const summary = summaryRows(data, sections)
    if (summary.length) {
      y = drawSectionTitle(doc, y, 'Summary')
      y = drawTable(
        doc,
        y,
        [
          { label: 'Metric', width: 220 },
          { label: 'Value', width: 140, align: 'right' },
        ],
        summary.map(([metric, value]) => ({
          values: [
            metric,
            COUNT_METRICS.has(metric)
              ? String(value)
              : metric === 'Refunds' ? formatRefundMoney(value) : formatMoney(value),
          ],
        })),
      )
    }

    if (sections.includes('monthly')) {
      y = drawSectionTitle(doc, y, data.breakdownLabel)
      y = drawTable(
        doc,
        y,
        [
          { label: 'Period', width: 95 },
          { label: 'Orders', width: 50, align: 'right' },
          { label: 'Sales', width: 75, align: 'right' },
          { label: 'Refunds', width: 70, align: 'right' },
          { label: 'Net sales', width: 75, align: 'right' },
          { label: 'Expenses', width: 70, align: 'right' },
          { label: 'Net profit', width: 75, align: 'right' },
        ],
        data.breakdown.map((row) => ({
          values: [
            row.label,
            String(row.orders),
            formatMoney(row.revenue),
            formatRefundMoney(row.refunds),
            formatMoney(netOf(row)),
            formatMoney(row.expenses),
            formatMoney(row.profit),
          ],
        })),
      )
    }

    if (sections.includes('spending')) {
      y = drawSectionTitle(doc, y, 'Spending by category')
      drawTable(
        doc,
        y,
        [
          { label: 'Category', width: 260 },
          { label: 'Amount', width: 120, align: 'right' },
        ],
        data.spending.map((row) => ({
          values: [row.category, formatMoney(row.amount)],
        })),
      )
    }
  })
}

async function createReportExport(db, query, user, kind) {
  const period = parseReportMonth(query.month)
  const sections = parseReportSections(query.sections)
  const data = await loadReportData(db, period)
  const generatedBy = actorLabel(user)
  if (kind === 'xlsx') {
    const buffer = await buildReportWorkbook(data, sections)
    return {
      buffer: Buffer.from(buffer),
      filename: reportFilename(period, 'xlsx'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      periodLabel: period.label,
      sections,
    }
  }
  const buffer = await buildReportPdfBuffer(data, sections, generatedBy)
  return {
    buffer,
    filename: reportFilename(period, 'pdf'),
    contentType: 'application/pdf',
    periodLabel: period.label,
    sections,
  }
}

module.exports = {
  createReportExport,
  buildReportWorkbook,
  buildReportPdfBuffer,
  loadReportData,
}
