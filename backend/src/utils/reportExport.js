const ExcelJS = require('exceljs')
const {
  actorLabel,
  formatMoney,
  parseReportPeriod,
  parseReportRange,
  parseReportSections,
  previousPeriod,
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

/** YYYY-MM keys from `firstKey` through the current month (empty when there is no data). */
function monthKeysSince(firstKey, now = new Date()) {
  if (!firstKey) return []
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const keys = []
  let [year, month] = firstKey.split('-').map(Number)
  for (let key = firstKey; key <= current; key = `${year}-${String(month).padStart(2, '0')}`) {
    keys.push(key)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return keys
}

// A month or a from/to range carries startDate/endDate (end exclusive); "all" uses the history window.
const DAILY_MAX_DAYS = 62

function dayKeysOf(period) {
  const keys = []
  const date = new Date(`${period.startDate}T00:00:00Z`)
  const end = new Date(`${period.endDate}T00:00:00Z`)
  while (date < end) {
    keys.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return keys
}

function rangeSql(dateSql, period) {
  if (period.startDate) {
    return { sql: `${dateSql} >= ? AND ${dateSql} < ?`, params: [period.startDate, period.endDate] }
  }
  // "All": every order, no date limit.
  return { sql: '1 = 1', params: [] }
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
  if (!period.startDate) return listExpenses(db, { days: 'all' })
  const expenses = await listExpenses(db, { from: period.startDate, toExclusive: period.endDate })
  return expenses.filter((expense) => {
    const date = String(expense.expense_date || '').slice(0, 10)
    return date >= period.startDate && date < period.endDate
  })
}

async function loadReportData(db, period) {
  if (period.startDate) {
    // Up to ~2 months: one row per day; longer ranges: one row per month.
    const days = dayKeysOf(period)
    const grain = days.length <= DAILY_MAX_DAYS ? 'day' : 'month'
    const salesByKey = await salesBuckets(db, period, grain)
    const summary = sumBuckets(salesByKey)
    const expenses = await loadExpensesInScope(db, period)
    const spending = roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))
    const spendByKey = expenseMap(expenses, grain)
    const keys = grain === 'day' ? days : [...new Set(days.map((key) => key.slice(0, 7)))]
    const breakdown = keys.map((key) => breakdownRow(
      grain === 'day' ? key : monthLabel(key),
      salesByKey.get(key) || EMPTY_TOTALS,
      spendByKey.get(key)?.amount || 0,
    ))
    return {
      period,
      summary: reportSummary(summary, spending),
      breakdown,
      breakdownLabel: grain === 'day' ? 'Daily breakdown' : 'Monthly breakdown',
      spending: categoryTotals(expenses),
    }
  }

  const salesByMonth = await salesBuckets(db, period, 'month')
  const summary = sumBuckets(salesByMonth)
  const expenses = await loadExpensesInScope(db, period)
  const spending = roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))
  const spendByMonth = expenseMap(expenses, 'month')
  // One row per month, from the first month with a sale or an expense up to this month.
  const firstMonth = [...salesByMonth.keys(), ...spendByMonth.keys()].sort()[0]
  const breakdown = monthKeysSince(firstMonth)
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

/** "+12.5%" / "-3.0%"; "n/a" when the previous value is 0 (no base to compare with). */
function changeText(current, previous) {
  const base = Number(previous) || 0
  if (!base) return 'n/a'
  const percent = ((Number(current) || 0) - base) / Math.abs(base) * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

/**
 * Summary rows as [metric, value] — or, when `data.previous` is set (compare on),
 * [metric, value, previous value, change].
 */
function summaryRows(data, sections) {
  const current = summaryRowsOf(data.summary, sections)
  if (!data.previous) return current
  const previous = summaryRowsOf(data.previous.summary, sections)
  return current.map(([metric, value], index) => {
    const before = previous[index][1]
    return [metric, value, before, changeText(value, before)]
  })
}

function summaryRowsOf(summary, sections) {
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
    const headers = data.previous
      ? ['Metric', data.period.label, `Previous (${data.previous.period.label})`, 'Change']
      : ['Metric', 'Value']
    const sheet = addSheet(workbook, 'Summary', headers, summary, [])
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const metric = row.getCell(1).value
      for (const index of data.previous ? [2, 3] : [2]) {
        const cell = row.getCell(index)
        if (COUNT_METRICS.has(metric)) {
          cell.numFmt = '#,##0'
        } else if (typeof cell.value === 'number') {
          cell.numFmt = '$#,##0.00'
        }
      }
    })
  }
  if (sections.includes('monthly')) {
    addSheet(
      workbook,
      data.breakdownLabel === 'Daily breakdown' ? 'Daily' : 'Monthly',
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
    y = drawNote(doc, y, data.previous
      ? `Figures follow the Reports page. Compared with ${data.previous.period.label}. The chart is shown as a table.`
      : 'Figures follow the Reports page. The chart is shown as a table.')

    const summary = summaryRows(data, sections)
    if (summary.length) {
      const formatValue = (metric, value) => (COUNT_METRICS.has(metric)
        ? String(value)
        : metric === 'Refunds' ? formatRefundMoney(value) : formatMoney(value))
      y = drawSectionTitle(doc, y, 'Summary')
      y = drawTable(
        doc,
        y,
        data.previous
          ? [
              { label: 'Metric', width: 150 },
              { label: 'This period', width: 110, align: 'right' },
              { label: 'Previous', width: 110, align: 'right' },
              { label: 'Change', width: 90, align: 'right' },
            ]
          : [
              { label: 'Metric', width: 220 },
              { label: 'Value', width: 140, align: 'right' },
            ],
        summary.map(([metric, value, before, change]) => ({
          values: data.previous
            ? [metric, formatValue(metric, value), formatValue(metric, before), change]
            : [metric, formatValue(metric, value)],
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
  const period = parseReportPeriod(query)
  const sections = parseReportSections(query.sections)
  const data = await loadReportData(db, period)
  // compare=1: add the previous period's figures and the change (only for a month or a range).
  // compare_from/compare_to name that period (the page sends yesterday, last week, …); else previousPeriod().
  const wantsCompare = ['1', 'true'].includes(String(query.compare))
  const comparePeriod = !wantsCompare
    ? null
    : query.compare_from != null || query.compare_to != null
      ? parseReportRange(query.compare_from, query.compare_to)
      : previousPeriod(period)
  if (comparePeriod) {
    const previous = await loadReportData(db, comparePeriod)
    data.previous = { period: comparePeriod, summary: previous.summary }
  }
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
