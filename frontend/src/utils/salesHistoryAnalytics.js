import { formatMonthYearFromKey } from './dateTimeFormat'
import { phnomPenhMonthKey, recentMonthKeys } from './phnomPenhTime'

export const DEFAULT_HISTORY_DAYS = 730

export function getCurrentMonthKey(date = new Date()) {
  return phnomPenhMonthKey(date)
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

  for (const value of recentMonthKeys(lookbackMonths, referenceDate)) {
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
      const refundMonthKey = getRefundDateKey(order)?.slice(0, 7)
      for (const monthKey of [getOrderMonthKey(order), refundMonthKey]) {
        if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
          monthSet.add(monthKey)
        }
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

function orderStatus(order) {
  return String(order?.status || '').trim().toLowerCase()
}

export function isRefundedOrder(order) {
  return orderStatus(order) === 'refunded'
}

export function isSoldOrder(order) {
  const status = orderStatus(order)
  return status === 'completed' || status === 'paid' || status === 'refunded'
}

export function getRefundDateKey(order) {
  if (!isRefundedOrder(order)) return null
  const raw = String(order.refundDate || order.refund_date || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : normalizeOrderDate(order)
}

function inPeriod(dateKey, periodKey) {
  if (!dateKey) return false
  if (!periodKey || periodKey === 'all') return true
  return dateKey.startsWith(periodKey)
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function summarizeSalesAndRefunds(orders, periodKey = 'all') {
  let sales = 0
  let salesOrders = 0
  let refunds = 0
  let refundOrders = 0

  for (const order of orders || []) {
    if (!isSoldOrder(order)) continue
    const amount = Number.parseFloat(order.total || 0) || 0
    if (inPeriod(normalizeOrderDate(order), periodKey)) {
      sales += amount
      salesOrders += 1
    }
    if (inPeriod(getRefundDateKey(order), periodKey)) {
      refunds += amount
      refundOrders += 1
    }
  }

  return {
    sales: roundMoney(sales),
    salesOrders,
    refunds: roundMoney(refunds),
    refundOrders,
    net: roundMoney(sales - refunds),
  }
}

export function filterOrdersForPeriod(orders, periodKey) {
  if (!periodKey || periodKey === 'all') return orders
  return orders.filter(
    (order) =>
      inPeriod(normalizeOrderDate(order), periodKey) ||
      inPeriod(getRefundDateKey(order), periodKey),
  )
}

export function filterCompletedOrders(orders) {
  return orders.filter(isSoldOrder)
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

  return buckets.map((bucket) => {
    const totals = summarizeSalesAndRefunds(orders, bucket.key)
    return {
      ...bucket,
      revenue: totals.net,
      sales: totals.sales,
      refunds: totals.refunds,
      orders: totals.salesOrders,
    }
  })
}

export function buildMonthlyTotalsChart(orders, monthOptions) {
  const monthEntries = monthOptions.filter((option) => option.value !== 'all')
  const labelByKey = Object.fromEntries(monthEntries.map((option) => [option.value, option.label]))

  return monthEntries
    .map((option) => {
      const monthKey = option.value
      const totals = summarizeSalesAndRefunds(orders, monthKey)
      const fullLabel = labelByKey[monthKey] || formatMonthLabel(monthKey)
      return {
        monthKey,
        label: fullLabel.split(' ')[0],
        fullLabel,
        revenue: totals.net,
        sales: totals.sales,
        refunds: totals.refunds,
        orders: totals.salesOrders,
      }
    })
    .reverse()
}

export function summarizeSalesMetrics(orders, periodKey = 'all') {
  const totals = summarizeSalesAndRefunds(orders, periodKey)
  return {
    grossRevenue: totals.sales,
    refunds: totals.refunds,
    netRevenue: totals.net,
    ordersFulfilled: totals.salesOrders,
    ordersRefunded: totals.refundOrders,
  }
}
