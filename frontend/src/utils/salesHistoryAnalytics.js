import { formatMonthYearFromKey } from './dateTimeFormat'

export const DEFAULT_HISTORY_DAYS = 730

export function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Build `/orders/history` query string. Accepts days number or `{ days | month }`. */
export function buildSalesHistoryQuery(options) {
  if (typeof options === 'number') {
    return `days=${options}`
  }

  if (options?.month && options.month !== 'all') {
    return `month=${encodeURIComponent(options.month)}`
  }

  if (options?.days) {
    return `days=${options.days}`
  }

  return `month=${encodeURIComponent(getCurrentMonthKey())}`
}

export function formatMonthLabel(monthKey, t) {
  if (typeof t === 'function') {
    return formatMonthYearFromKey(monthKey, t) || monthKey
  }
  const [year, month] = String(monthKey || '').split('-').map(Number)
  if (!year || !month) return monthKey
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function buildMonthFilterOptions(
  lookbackMonths = 6,
  referenceDate = new Date(),
  t,
  allMonthsLabel = 'All months in range',
) {
  const options = [{ value: 'all', label: allMonthsLabel }]

  for (let i = 0; i < lookbackMonths; i += 1) {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1)
    const value = getCurrentMonthKey(date)
    options.push({
      value,
      label: formatMonthLabel(value, t),
    })
  }

  return options
}

export function buildDynamicMonthFilterOptions(
  orders = [],
  expenses = [],
  referenceDate = new Date(),
  t,
  allMonthsLabel = 'All months in range',
) {
  const options = [{ value: 'all', label: allMonthsLabel }]
  const monthSet = new Set()

  // Always include the current active month so users can filter current month
  monthSet.add(getCurrentMonthKey(referenceDate))

  // Collect distinct months from actual completed orders
  if (Array.isArray(orders)) {
    for (const order of orders) {
      const monthKey = getOrderMonthKey(order)
      if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
        monthSet.add(monthKey)
      }
    }
  }

  // Collect distinct months from actual expenses
  if (Array.isArray(expenses)) {
    for (const expense of expenses) {
      const monthKey = String(expense?.expense_date || '').slice(0, 7)
      if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
        monthSet.add(monthKey)
      }
    }
  }

  // Sort descending: newest month first
  const sortedMonths = Array.from(monthSet).sort((a, b) => b.localeCompare(a))

  for (const value of sortedMonths) {
    options.push({
      value,
      label: formatMonthLabel(value, t),
    })
  }

  return options
}

export function normalizeOrderDate(order) {
  if (!order?.date) return null
  const raw = String(order.date).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getOrderMonthKey(order) {
  const normalized = normalizeOrderDate(order)
  return normalized ? normalized.slice(0, 7) : null
}

export function filterOrdersByMonth(orders, monthKey) {
  if (!monthKey || monthKey === 'all') return orders
  return orders.filter((order) => getOrderMonthKey(order) === monthKey)
}

export function filterCompletedOrders(orders) {
  return orders.filter((order) => {
    const status = String(order.status || '').trim().toLowerCase()
    return status === 'completed' || status === 'paid' || status === 'refunded'
  })
}

export function buildDailySalesForMonth(orders, monthKey) {
  if (!monthKey || monthKey === 'all') return []

  const [year, month] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const buckets = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1
    const key = `${monthKey}-${String(day).padStart(2, '0')}`
    return {
      key,
      label: String(day),
      revenue: 0,
      orders: 0,
    }
  })

  const bucketMap = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]))

  for (const order of orders) {
    if (String(order.status || '').toLowerCase() === 'refunded') continue
    const dateKey = normalizeOrderDate(order)
    if (!dateKey || !dateKey.startsWith(monthKey)) continue
    const bucket = bucketMap[dateKey]
    if (!bucket) continue
    bucket.revenue += Number.parseFloat(order.total || 0)
    bucket.orders += 1
  }

  return buckets.map((bucket) => ({
    ...bucket,
    revenue: Math.round(bucket.revenue * 100) / 100,
  }))
}

export function buildMonthlyTotalsChart(orders, monthOptions) {
  const monthEntries = monthOptions.filter((option) => option.value !== 'all')
  const labelByKey = Object.fromEntries(monthEntries.map((option) => [option.value, option.label]))

  return monthEntries
    .map((option) => {
      const monthKey = option.value
      const monthOrders = filterOrdersByMonth(orders, monthKey).filter(
        (o) => String(o.status || '').toLowerCase() !== 'refunded',
      )
      const revenue = monthOrders.reduce(
        (sum, order) => sum + Number.parseFloat(order.total || 0),
        0,
      )
      const fullLabel = labelByKey[monthKey] || formatMonthLabel(monthKey)
      return {
        monthKey,
        label: fullLabel.split(' ')[0],
        fullLabel,
        revenue: Math.round(revenue * 100) / 100,
        orders: monthOrders.length,
      }
    })
    .reverse()
}

export function summarizeSalesMetrics(orders) {
  const validOrders = orders.filter((o) => String(o.status || '').toLowerCase() !== 'refunded')
  const refundedOrders = orders.filter((o) => String(o.status || '').toLowerCase() === 'refunded')

  const grossRevenue = validOrders.reduce((sum, order) => sum + Number.parseFloat(order.total || 0), 0)
  const cashTotal = validOrders
    .filter((order) => order.payment === 'Cash')
    .reduce((sum, order) => sum + Number.parseFloat(order.total || 0), 0)
  const bankScanTotal = validOrders
    .filter((order) => order.payment === 'Bank Scan')
    .reduce((sum, order) => sum + Number.parseFloat(order.total || 0), 0)

  return {
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    ordersFulfilled: validOrders.length,
    ordersRefunded: refundedOrders.length,
    cashTotal: Math.round(cashTotal * 100) / 100,
    bankScanTotal: Math.round(bankScanTotal * 100) / 100,
  }
}
