function column(alias, name) {
  return alias ? `${alias}.${name}` : name
}

function saleStatusSql(alias = '') {
  return `UPPER(${column(alias, 'status')}) IN ('COMPLETED', 'PAID', 'REFUNDED')`
}

function refundedStatusSql(alias = '') {
  return `UPPER(${column(alias, 'status')}) = 'REFUNDED'`
}

function refundDateSql(alias = '') {
  return `COALESCE(${column(alias, 'voided_at')}, ${column(alias, 'updated_at')})`
}

function roundMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100) / 100
}

function toCount(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function salesAndRefunds({ orders = 0, sales = 0, refundOrders = 0, refunds = 0 } = {}) {
  const gross = roundMoney(sales)
  const refunded = roundMoney(refunds)
  return {
    orders: toCount(orders),
    sales: gross,
    refundOrders: toCount(refundOrders),
    refunds: refunded,
    net: roundMoney(gross - refunded),
  }
}

function mergeSalesAndRefunds(salesRows = [], refundRows = []) {
  const buckets = new Map()
  const entry = (key) => {
    if (!buckets.has(key)) buckets.set(key, { orders: 0, sales: 0, refundOrders: 0, refunds: 0 })
    return buckets.get(key)
  }
  for (const row of salesRows) {
    const current = entry(row.bucket)
    current.orders += toCount(row.orders)
    current.sales += Number(row.amount) || 0
  }
  for (const row of refundRows) {
    const current = entry(row.bucket)
    current.refundOrders += toCount(row.orders)
    current.refunds += Number(row.amount) || 0
  }
  return new Map([...buckets.entries()].map(([key, value]) => [key, salesAndRefunds(value)]))
}

function formatRefundMoney(value) {
  const amount = Math.abs(roundMoney(value))
  const text = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return amount === 0 ? text : `-${text}`
}

module.exports = {
  formatRefundMoney,
  mergeSalesAndRefunds,
  refundDateSql,
  refundedStatusSql,
  saleStatusSql,
  salesAndRefunds,
}
