const { parseBackupPeriod } = require('./backupPeriod')
const {
  actorLabel,
  formatMoney,
  pdfSafe,
  roundMoney,
  salesPdfFilename,
} = require('./exportParams')
const { drawDocumentHeader, drawNote, drawSectionTitle, drawTable, renderPdf } = require('./pdfLayout')
const {
  formatRefundMoney,
  refundDateSql,
  refundedStatusSql,
  saleStatusSql,
} = require('./salesTotals')

const SOLD = saleStatusSql()
const REFUNDED = refundedStatusSql()
const REFUND_DATE = refundDateSql()
const PAYMENT_SQL = `COALESCE(NULLIF(payment_method, ''), NULLIF(payment_type, ''), 'Cash')`
const TOTAL_SQL = `COALESCE(total, total_amount, 0)`

const FLOOR_LABELS = {
  1: 'Table 1',
  2: 'Table 2',
  3: 'Table 3',
  4: 'Table 4',
  5: 'Table 5',
  6: 'Table 6',
  7: 'Table 7',
  8: 'Table 8',
  9: 'VIP Room 1',
  10: 'VIP Room 2',
}

function paymentBucket(method) {
  const value = String(method || 'Cash').trim().toLowerCase()
  if (value === 'bank scan') return 'bank'
  if (value === 'cash') return 'cash'
  return 'other'
}

function sourceLabel(row) {
  const target = row.target_id == null ? '' : String(row.target_id)
  if (!target || target === 'takeout' || row.source_type === 'Take Out') return 'Take Out'
  return FLOOR_LABELS[target] || `Table ${target}`
}

function orderLabel(row) {
  const invoice = String(row.invoice_id || '').trim()
  return invoice || String(row.id)
}

function statusLabel(status) {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'paid') return 'Paid'
  if (value === 'completed') return 'Completed'
  if (value === 'refunded') return 'Refunded'
  return pdfSafe(status)
}

function emptyTotals() {
  return { orders: 0, gross: 0, refundOrders: 0, refunds: 0, net: 0, cash: 0, bank: 0, other: 0 }
}

function addSale(totals, payment, amount, count = 1) {
  totals.orders += count
  totals.gross = roundMoney(totals.gross + amount)
  totals.net = roundMoney(totals.net + amount)
  const bucket = paymentBucket(payment)
  totals[bucket] = roundMoney(totals[bucket] + amount)
}

function addRefund(totals, payment, amount, count = 1) {
  totals.refundOrders += count
  totals.refunds = roundMoney(totals.refunds + amount)
  totals.net = roundMoney(totals.net - amount)
  const bucket = paymentBucket(payment)
  totals[bucket] = roundMoney(totals[bucket] - amount)
}

async function loadMonthSales(db, period) {
  const [rows] = await db.execute(
    `
    SELECT
      id,
      invoice_id,
      target_id,
      source_type,
      ${PAYMENT_SQL} AS payment,
      ${TOTAL_SQL} AS total,
      status,
      DATE_FORMAT(updated_at, '%Y-%m-%d %h:%i %p') AS sold_at
    FROM orders
    WHERE ${SOLD}
      AND updated_at >= ? AND updated_at < ?
    ORDER BY updated_at ASC, id ASC
    `,
    [period.startDate, period.endDate],
  )

  const [refundRows] = await db.execute(
    `
    SELECT
      id,
      invoice_id,
      ${PAYMENT_SQL} AS payment,
      ${TOTAL_SQL} AS total,
      DATE_FORMAT(updated_at, '%Y-%m-%d %h:%i %p') AS sold_at,
      DATE_FORMAT(${REFUND_DATE}, '%Y-%m-%d %h:%i %p') AS refunded_at
    FROM orders
    WHERE ${REFUNDED}
      AND ${REFUND_DATE} >= ? AND ${REFUND_DATE} < ?
    ORDER BY ${REFUND_DATE} ASC, id ASC
    `,
    [period.startDate, period.endDate],
  )

  const totals = emptyTotals()
  const lines = rows.map((row) => {
    const amount = roundMoney(row.total)
    addSale(totals, row.payment, amount)
    return {
      orderId: orderLabel(row),
      source: sourceLabel(row),
      soldAt: row.sold_at || '',
      payment: row.payment || 'Cash',
      total: amount,
      status: statusLabel(row.status),
    }
  })
  const refunds = refundRows.map((row) => {
    const amount = roundMoney(row.total)
    addRefund(totals, row.payment, amount)
    return {
      orderId: orderLabel(row),
      soldAt: row.sold_at || '',
      refundedAt: row.refunded_at || '',
      payment: row.payment || 'Cash',
      total: amount,
    }
  })
  return { lines, refunds, totals }
}

async function loadAllTimeSummary(db) {
  const [saleRows] = await db.execute(
    `
    SELECT
      DATE_FORMAT(updated_at, '%Y-%m') AS month_key,
      ${PAYMENT_SQL} AS payment,
      COUNT(*) AS orders,
      COALESCE(SUM(${TOTAL_SQL}), 0) AS amount
    FROM orders
    WHERE ${SOLD}
    GROUP BY DATE_FORMAT(updated_at, '%Y-%m'), ${PAYMENT_SQL}
    `,
  )
  const [refundRows] = await db.execute(
    `
    SELECT
      DATE_FORMAT(${REFUND_DATE}, '%Y-%m') AS month_key,
      ${PAYMENT_SQL} AS payment,
      COUNT(*) AS orders,
      COALESCE(SUM(${TOTAL_SQL}), 0) AS amount
    FROM orders
    WHERE ${REFUNDED}
    GROUP BY DATE_FORMAT(${REFUND_DATE}, '%Y-%m'), ${PAYMENT_SQL}
    `,
  )

  const byMonth = new Map()
  const monthTotals = (key) => {
    if (!byMonth.has(key)) byMonth.set(key, emptyTotals())
    return byMonth.get(key)
  }
  for (const row of saleRows) {
    const month = monthTotals(row.month_key)
    const amount = roundMoney(row.amount)
    addSale(month, row.payment, amount, Number(row.orders) || 0)
  }
  for (const row of refundRows) {
    const month = monthTotals(row.month_key)
    const amount = roundMoney(row.amount)
    addRefund(month, row.payment, amount, Number(row.orders) || 0)
  }

  const months = [...byMonth.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([monthKey, month]) => ({ monthKey, ...month }))
  const totals = months.reduce((sum, month) => ({
    orders: sum.orders + month.orders,
    gross: roundMoney(sum.gross + month.gross),
    refundOrders: sum.refundOrders + month.refundOrders,
    refunds: roundMoney(sum.refunds + month.refunds),
    net: roundMoney(sum.net + month.net),
    cash: roundMoney(sum.cash + month.cash),
    bank: roundMoney(sum.bank + month.bank),
    other: roundMoney(sum.other + month.other),
  }), emptyTotals())
  return { months, totals }
}

function netOf(totals) {
  return totals.net ?? roundMoney((totals.gross || 0) - (totals.refunds || 0))
}

function monthName(monthKey) {
  const [year, month] = String(monthKey || '').split('-')
  const index = Number(month) - 1
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  if (!year || !names[index]) return monthKey
  return `${names[index]} ${year}`
}

function buildSalesPdfBuffer({ period, generatedBy, monthData, summary }) {
  return renderPdf((doc) => {
    doc.info.Title = 'Sales data'
    doc.info.Author = generatedBy
    let y = drawDocumentHeader(doc, {
      title: 'Sales data',
      periodLabel: period.label,
      generatedBy,
    })

    if (period.scope === 'month') {
      y = drawNote(doc, y, `Orders sold in ${period.label}. Refunds are counted on the day they were made.`)
      const rows = monthData.lines.map((line) => ({
        values: [
          line.orderId,
          line.source,
          line.soldAt,
          line.payment,
          formatMoney(line.total),
          line.status,
        ],
      }))
      rows.push({
        total: true,
        values: [
          'Total',
          '',
          '',
          `${monthData.totals.orders} orders`,
          formatMoney(monthData.totals.gross),
          '',
        ],
      })
      y = drawTable(doc, y, [
        { label: 'Order ID', width: 90 },
        { label: 'Source', width: 100 },
        { label: 'Date/Time', width: 120 },
        { label: 'Payment', width: 75 },
        { label: 'Total', width: 70, align: 'right' },
        { label: 'Status', width: 60 },
      ], rows)
      const refunds = monthData.refunds || []
      if (refunds.length) {
        y = drawSectionTitle(doc, y, `Refunds made in ${period.label}`)
        const refundRows = refunds.map((line) => ({
          values: [
            line.orderId,
            line.soldAt,
            line.refundedAt,
            line.payment,
            formatRefundMoney(line.total),
          ],
        }))
        refundRows.push({
          total: true,
          values: [
            'Total',
            '',
            '',
            `${monthData.totals.refundOrders || 0} refunds`,
            formatRefundMoney(monthData.totals.refunds),
          ],
        })
        y = drawTable(doc, y, [
          { label: 'Order ID', width: 90 },
          { label: 'Sold at', width: 120 },
          { label: 'Refunded at', width: 120 },
          { label: 'Payment', width: 85 },
          { label: 'Amount', width: 80, align: 'right' },
        ], refundRows)
      }
      y = drawNote(
        doc,
        y,
        `Sales ${formatMoney(monthData.totals.gross)}    Refunds ${formatRefundMoney(monthData.totals.refunds)}    Net ${formatMoney(netOf(monthData.totals))}`,
      )
      y = drawNote(doc, y, `Net cash ${formatMoney(monthData.totals.cash)}    Net bank ${formatMoney(monthData.totals.bank)}`)
      if (monthData.totals.other !== 0) {
        drawNote(doc, y, `Net other payments ${formatMoney(monthData.totals.other)}`)
      }
      return
    }

    y = drawNote(doc, y, 'Month-by-month summary. Sales by sale month, refunds by refund month. This file does not list every order.')
    const rows = summary.months.map((month) => ({
      values: [
        monthName(month.monthKey),
        String(month.orders),
        formatMoney(month.gross),
        formatRefundMoney(month.refunds),
        formatMoney(netOf(month)),
        formatMoney(month.cash),
        formatMoney(month.bank),
      ],
    }))
    rows.push({
      total: true,
      values: [
        'Grand total',
        String(summary.totals.orders),
        formatMoney(summary.totals.gross),
        formatRefundMoney(summary.totals.refunds),
        formatMoney(netOf(summary.totals)),
        formatMoney(summary.totals.cash),
        formatMoney(summary.totals.bank),
      ],
    })
    y = drawTable(doc, y, [
      { label: 'Month', width: 95 },
      { label: 'Orders', width: 50, align: 'right' },
      { label: 'Sales', width: 80, align: 'right' },
      { label: 'Refunds', width: 75, align: 'right' },
      { label: 'Net', width: 80, align: 'right' },
      { label: 'Net cash', width: 65, align: 'right' },
      { label: 'Net bank', width: 65, align: 'right' },
    ], rows)
    if (summary.totals.other !== 0) {
      drawNote(doc, y, `Net other payments ${formatMoney(summary.totals.other)} are included in net only.`)
    }
  })
}

async function createSalesPdf(db, query, user) {
  const period = parseBackupPeriod(query)
  const generatedBy = actorLabel(user)
  const payload = period.scope === 'month'
    ? { monthData: await loadMonthSales(db, period), summary: null }
    : { monthData: null, summary: await loadAllTimeSummary(db) }
  const buffer = await buildSalesPdfBuffer({ period, generatedBy, ...payload })
  const totals = period.scope === 'month' ? payload.monthData.totals : payload.summary.totals
  return {
    buffer,
    filename: salesPdfFilename(period),
    periodLabel: period.label,
    totals,
  }
}

module.exports = {
  createSalesPdf,
  buildSalesPdfBuffer,
  paymentBucket,
  sourceLabel,
}
