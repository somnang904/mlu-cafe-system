const ExcelJS = require('exceljs')
const { isAdminRole } = require('../constants/permissions')
const { getExchangeRate } = require('./exchangeRate')
const { summarizeCashOrders, DEFAULT_EXCHANGE_RATE } = require('./cashDrawer')
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

// staffId: only that cashier's sales (null for the whole shop).
async function bucketRows(db, statusSql, dateSql, period, grain, staffId = null) {
  const format = grain === 'day' ? '%Y-%m-%d' : '%Y-%m'
  const range = rangeSql(dateSql, period)
  const mine = staffId != null ? ' AND staff_id = ?' : ''
  const [rows] = await db.execute(
    `
    SELECT
      DATE_FORMAT(${dateSql}, '${format}') AS bucket,
      COUNT(*) AS orders,
      COALESCE(SUM(${TOTAL_SQL}), 0) AS amount
    FROM orders
    WHERE ${statusSql} AND ${range.sql}${mine}
    GROUP BY DATE_FORMAT(${dateSql}, '${format}')
    `,
    staffId != null ? [...range.params, staffId] : range.params,
  )
  return rows
}

async function salesBuckets(db, period, grain, staffId = null) {
  const sales = await bucketRows(db, SOLD, 'updated_at', period, grain, staffId)
  const refunds = await bucketRows(db, REFUNDED, REFUND_DATE, period, grain, staffId)
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

// amount is dollars (riel expenses converted); khr is the riel actually paid for riel expenses
// and usd the dollars of the dollar expenses only.
function categoryTotals(expenses) {
  const totals = new Map()
  for (const expense of expenses) {
    const category = expense.category || 'Others'
    const entry = totals.get(category) || { amount: 0, khr: 0, usd: 0 }
    entry.amount = roundMoney(entry.amount + Number(expense.amount || 0))
    if (expense.currency === 'KHR' && expense.amount_khr) entry.khr += Number(expense.amount_khr)
    else entry.usd = roundMoney(entry.usd + Number(expense.amount || 0))
    totals.set(category, entry)
  }
  return [...totals.entries()]
    .map(([category, entry]) => ({ category, amount: entry.amount, khr: entry.khr, usd: entry.usd }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))
}

/**
 * Money taken in the period: cash kept in the drawer in dollars and in riel (what was paid in
 * each currency, less change given), and what came in by bank / ABA.
 */
async function moneyTaken(db, period, staffId) {
  const range = rangeSql('updated_at', period)
  const mine = staffId != null ? ' AND staff_id = ?' : ''
  const [rows] = await db.execute(
    `SELECT ${TOTAL_SQL} AS total, received_usd, received_khr, change_usd, exchange_rate,
            COALESCE(NULLIF(payment_method, ''), 'Cash') AS method
     FROM orders
     WHERE ${SOLD} AND ${range.sql}${mine}`,
    staffId != null ? [...range.params, staffId] : range.params,
  )
  const cash = rows.filter((row) => String(row.method).toLowerCase() === 'cash')
  const drawer = summarizeCashOrders(cash)
  const bank = rows.filter((row) => String(row.method).toLowerCase() !== 'cash')
  const refundRange = rangeSql(REFUND_DATE, period)
  const [refunded] = await db.execute(
    `SELECT ${TOTAL_SQL} AS total, received_usd, received_khr, exchange_rate,
            COALESCE(NULLIF(payment_method, ''), 'Cash') AS method
     FROM orders
     WHERE ${REFUNDED} AND ${refundRange.sql}${mine}`,
    staffId != null ? [...refundRange.params, staffId] : refundRange.params,
  )
  const sales = byCurrency(rows)
  const refunds = byCurrency(refunded)
  return {
    cashUsd: drawer.netUsd,
    cashKhr: drawer.netKhr,
    salesUsd: sales.usd,
    salesKhr: sales.khr,
    refundsUsd: refunds.usd,
    refundsKhr: refunds.khr,
    bankUsd: roundMoney(bank.reduce((sum, row) => sum + Number(row.total || 0), 0)),
  }
}

/**
 * Bills split by the currency the customer paid in: a bill paid in dollars (or by bank) counts in
 * dollars, a bill paid in riel counts as its value in riel, and a mixed cash payment counts the
 * dollars handed over in dollars and the rest of the bill in riel.
 */
function byCurrency(orders) {
  let salesUsd = 0
  let salesKhr = 0
  for (const order of orders) {
    const total = Number(order.total) || 0
    const khr = Number(order.received_khr) || 0
    if (String(order.method).toLowerCase() !== 'cash' || khr <= 0) {
      salesUsd += total
      continue
    }
    const usd = Math.min(total, Number(order.received_usd) || 0)
    const rate = Number(order.exchange_rate) > 0 ? Number(order.exchange_rate) : DEFAULT_EXCHANGE_RATE
    salesUsd += usd
    salesKhr += Math.round(((total - usd) * rate) / 100) * 100
  }
  return { usd: roundMoney(salesUsd), khr: salesKhr }
}

function toKhr(usd, rate) {
  return Math.round(Number(usd || 0) * rate) || 0
}

/**
 * A summary metric in riel. Expenses use the riel actually paid for riel expenses (10,000 ៛ stays
 * 10,000 ៛, not $2.44 converted back); net profit follows from that. The rest is dollars × rate.
 */
function rielFor(metric, value, data) {
  const rate = rateOf(data)
  // Spending rows from before the riel split have only `amount`: all of it counts as dollars.
  const expensesKhr = (data.spending || []).reduce(
    (sum, row) => sum + (row.khr || 0) + toKhr(row.usd ?? row.amount, rate),
    0,
  )
  if (metric === 'Expenses') return Math.round(expensesKhr)
  if (metric === 'Net profit') return toKhr(netOf(data.summary), rate) - Math.round(expensesKhr)
  return toKhr(value, rate)
}

function rateOf(data) {
  return Number(data.rate) > 0 ? Number(data.rate) : DEFAULT_EXCHANGE_RATE
}

function formatKhrText(khr) {
  return `${Math.round(Number(khr) || 0).toLocaleString('en-US')} KHR`
}

async function loadExpensesInScope(db, period, staffId = null) {
  const { listExpenses } = require('./expenses')
  if (!period.startDate) return listExpenses(db, { days: 'all', createdBy: staffId })
  const expenses = await listExpenses(db, { from: period.startDate, toExclusive: period.endDate, createdBy: staffId })
  return expenses.filter((expense) => {
    const date = String(expense.expense_date || '').slice(0, 10)
    return date >= period.startDate && date < period.endDate
  })
}

/** `staffId`: a cashier's own sales and expenses only; null for the whole shop. */
async function loadReportData(db, period, staffId = null) {
  if (period.startDate) {
    // Up to ~2 months: one row per day; longer ranges: one row per month.
    const days = dayKeysOf(period)
    const grain = days.length <= DAILY_MAX_DAYS ? 'day' : 'month'
    const salesByKey = await salesBuckets(db, period, grain, staffId)
    const summary = sumBuckets(salesByKey)
    const expenses = await loadExpensesInScope(db, period, staffId)
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
      rate: await getExchangeRate(db),
      taken: await moneyTaken(db, period, staffId),
    }
  }

  const salesByMonth = await salesBuckets(db, period, 'month', staffId)
  const summary = sumBuckets(salesByMonth)
  const expenses = await loadExpensesInScope(db, period, staffId)
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
    rate: await getExchangeRate(db),
    taken: await moneyTaken(db, period, staffId),
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
  const rate = rateOf(data)
  if (summary.length) {
    // The last column is this period in riel at the shop's rate.
    const rielHeader = `Riel (៛, $1 = ${rate.toLocaleString('en-US')} ៛)`
    const headers = data.previous
      ? ['Metric', data.period.label, `Previous (${data.previous.period.label})`, 'Change', rielHeader]
      : ['Metric', 'Value', rielHeader]
    const rows = summary.map((values) => [
      ...values,
      COUNT_METRICS.has(values[0]) ? null : rielFor(values[0], values[1], data),
    ])
    const rielIndex = headers.length
    const sheet = addSheet(workbook, 'Summary', headers, rows, [])
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
      const riel = row.getCell(rielIndex)
      if (typeof riel.value === 'number') riel.numFmt = '#,##0" ៛"'
    })
  }
  if (sections.includes('income') && data.taken) {
    const sheet = addSheet(
      workbook,
      'Money taken',
      ['Paid with', 'Amount', 'Currency'],
      [
        ['Cash in US dollars (kept in the drawer)', data.taken.cashUsd, 'USD'],
        ['Cash in riel (kept in the drawer)', data.taken.cashKhr, 'KHR'],
        ['Bank / ABA', data.taken.bankUsd, 'USD'],
      ],
      [],
    )
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      row.getCell(2).numFmt = row.getCell(3).value === 'KHR' ? '#,##0" ៛"' : '$#,##0.00'
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
    const sheet = addSheet(
      workbook,
      'Spending by category',
      ['Category', 'Amount', 'Paid in riel (៛)'],
      data.spending.map((row) => [row.category, row.amount, row.khr || null]),
      [2],
    )
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && typeof row.getCell(3).value === 'number') row.getCell(3).numFmt = '#,##0" ៛"'
    })
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
              { label: 'Metric', width: 120 },
              { label: 'This period', width: 95, align: 'right' },
              { label: 'Previous', width: 95, align: 'right' },
              { label: 'Change', width: 75, align: 'right' },
              { label: 'Riel', width: 95, align: 'right' },
            ]
          : [
              { label: 'Metric', width: 200 },
              { label: 'Value', width: 120, align: 'right' },
              { label: 'Riel', width: 120, align: 'right' },
            ],
        summary.map(([metric, value, before, change]) => {
          const riel = COUNT_METRICS.has(metric) ? '' : formatKhrText(rielFor(metric, value, data))
          return {
            values: data.previous
              ? [metric, formatValue(metric, value), formatValue(metric, before), change, riel]
              : [metric, formatValue(metric, value), riel],
          }
        }),
      )
      y = drawNote(doc, y, `Riel at the shop's rate: $1 = ${rateOf(data).toLocaleString('en-US')} KHR.`)
    }

    if (sections.includes('income') && data.taken) {
      y = drawSectionTitle(doc, y, 'Money taken')
      y = drawTable(
        doc,
        y,
        [
          { label: 'Paid with', width: 260 },
          { label: 'Amount', width: 140, align: 'right' },
        ],
        [
          { values: ['Cash in US dollars (kept in the drawer)', formatMoney(data.taken.cashUsd)] },
          { values: ['Cash in riel (kept in the drawer)', formatKhrText(data.taken.cashKhr)] },
          { values: ['Bank / ABA', formatMoney(data.taken.bankUsd)] },
        ],
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
          { label: 'Category', width: 220 },
          { label: 'Amount', width: 110, align: 'right' },
          { label: 'Paid in riel', width: 120, align: 'right' },
        ],
        data.spending.map((row) => ({
          values: [row.category, formatMoney(row.amount), row.khr ? formatKhrText(row.khr) : ''],
        })),
      )
    }
  })
}

async function createReportExport(db, query, user, kind) {
  const period = parseReportPeriod(query)
  const sections = parseReportSections(query.sections)
  // Cashiers export their own report, the same figures the Reports page shows them.
  const staffId = isAdminRole(user?.role) ? null : user?.id ?? -1
  const data = await loadReportData(db, period, staffId)
  // compare=1: add the previous period's figures and the change (only for a month or a range).
  // compare_from/compare_to name that period (the page sends yesterday, last week, …); else previousPeriod().
  const wantsCompare = ['1', 'true'].includes(String(query.compare))
  const comparePeriod = !wantsCompare
    ? null
    : query.compare_from != null || query.compare_to != null
      ? parseReportRange(query.compare_from, query.compare_to)
      : previousPeriod(period)
  if (comparePeriod) {
    const previous = await loadReportData(db, comparePeriod, staffId)
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
