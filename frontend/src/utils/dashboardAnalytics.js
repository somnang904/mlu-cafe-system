import { formatDateTimeDisplay, formatOrderDate, sortOrdersByDateTime } from './dateTimeFormat'
import {
  getRefundDateKey,
  isSoldOrder,
  normalizeOrderDate,
  summarizeSalesAndRefunds,
} from './salesHistoryAnalytics'

export function buildWeeklySalesData(orders) {
  const days = []
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - i)
    // Local calendar day — matches order.date from the API (not UTC).
    const key = formatOrderDate(date)
    days.push({
      key,
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      fullLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: 0,
    })
  }

  return days.map((day) => ({
    ...day,
    revenue: summarizeSalesAndRefunds(orders, day.key).net,
  }))
}

export function buildPaymentSplitData(orders, options = {}) {
  // Default: calendar month we are in now (local), e.g. 2026-10 for October.
  const monthKey =
    options.monthKey ||
    formatOrderDate(options.now || new Date()).slice(0, 7)

  let cash = 0
  let bankScan = 0

  for (const order of orders) {
    if (!isSoldOrder(order)) continue
    const total = Number.parseFloat(order.total || 0) || 0
    const sold = String(normalizeOrderDate(order) || '').startsWith(monthKey) ? total : 0
    const refunded = String(getRefundDateKey(order) || '').startsWith(monthKey) ? total : 0
    const amount = sold - refunded
    const method = order.payment_method || order.payment || 'Cash'
    if (method === 'Bank Scan') {
      bankScan += amount
    } else {
      cash += amount
    }
  }

  return [
    { name: 'Cash', value: Math.round(cash * 100) / 100, monthKey },
    { name: 'Bank Scan', value: Math.round(bankScan * 100) / 100, monthKey },
  ]
}

export function buildDashboardStats(orders, user, todaySpending = 0) {
  const completed = orders.filter((order) => !order.status || order.status === 'Completed')
  // Must use local date — toISOString() is UTC and breaks after midnight in Cambodia (UTC+7).
  const todayKey = formatOrderDate(new Date())
  const today = summarizeSalesAndRefunds(orders, todayKey)
  const spending = Number(todaySpending) || 0
  const netProfit = Math.round((today.net - spending) * 100) / 100

  return {
    todayRevenue: today.sales,
    todayRefunds: today.refunds,
    todayRefundCount: today.refundOrders,
    todayNetSales: today.net,
    todaySpending: Math.round(spending * 100) / 100,
    netProfit,
    todayOrderCount: today.salesOrders,
    totalOrders: completed.length,
    cashierName: user?.display_name || user?.displayName || 'Staff',
  }
}

export function buildPopularPicks(orders, limit = 6) {
  const counts = new Map()

  for (const order of orders) {
    if (order.status && order.status !== 'Completed') continue
    const lines = Array.isArray(order.items) ? order.items : []
    for (const line of lines) {
      const name = String(line?.name || '').trim()
      if (!name) continue
      const quantity = Number.parseFloat(line.qty)
      const current = counts.get(name) || {
        sold: 0,
        menuItemId: line.menu_item_id || line.menuItemId || null,
        imageUrl: line.image_url || line.imageUrl || '',
      }
      current.sold += Number.isFinite(quantity) ? quantity : 0
      if (!current.menuItemId && (line.menu_item_id || line.menuItemId)) {
        current.menuItemId = line.menu_item_id || line.menuItemId
      }
      if (!current.imageUrl && (line.image_url || line.imageUrl)) {
        current.imageUrl = line.image_url || line.imageUrl
      }
      counts.set(name, current)
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1].sold - left[1].sold || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, data], index) => ({
      rank: index + 1,
      name,
      sold: Math.round(data.sold),
      menuItemId: data.menuItemId,
      imageUrl: data.imageUrl,
    }))
}

export function buildRecentOrders(orders, limit = 4) {
  return sortOrdersByDateTime(
    orders.filter((order) => !order.status || order.status === 'Completed'),
    'desc',
  )
    .slice(0, limit)
    .map((order) => ({
      id: order.invoice_id || order.id,
      item: order.summary || 'Completed order',
      total: `$${Number.parseFloat(order.total || 0).toFixed(2)}`,
      time: formatDateTimeDisplay(order.date, order.time),
    }))
}