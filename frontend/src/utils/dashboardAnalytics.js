import { activeLocale, formatDateTimeDisplay, sortOrdersByDateTime } from './dateTimeFormat'
import { phnomPenhDayKey, phnomPenhMonthKey, shiftDayKey, weekdayOfDayKey } from './phnomPenhTime'
import {
  getRefundDateKey,
  isSoldOrder,
  normalizeOrderDate,
  summarizeSalesAndRefunds,
} from './salesHistoryAnalytics'

export const COMPLETED_STATUSES = ['completed', 'paid']

export function isCompletedStatus(status) {
  if (!status) return true
  return COMPLETED_STATUSES.includes(String(status).trim().toLowerCase())
}

function dayKeyToDate(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

export function buildWeeklySalesData(orders, now = new Date()) {
  const days = []
  const todayKey = phnomPenhDayKey(now)
  const locale = activeLocale()
  for (let i = 6; i >= 0; i -= 1) {
    const key = shiftDayKey(todayKey, -i)
    const date = dayKeyToDate(key)
    days.push({
      key,
      weekday: weekdayOfDayKey(key),
      label: date.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }),
      fullLabel: date.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      revenue: 0,
    })
  }

  return days.map((day) => ({
    ...day,
    revenue: summarizeSalesAndRefunds(orders, day.key).net,
  }))
}

export function buildPaymentSplitData(orders, options = {}) {
  const monthKey = options.monthKey || phnomPenhMonthKey(options.now || new Date())

  let cash = 0
  let bankScan = 0
  let other = 0

  for (const order of orders) {
    if (!isSoldOrder(order)) continue
    const total = Number.parseFloat(order.total || 0) || 0
    const sold = String(normalizeOrderDate(order) || '').startsWith(monthKey) ? total : 0
    const refunded = String(getRefundDateKey(order) || '').startsWith(monthKey) ? total : 0
    const amount = sold - refunded
    const method = String(order.payment_method || order.payment || order.payment_type || 'Cash').trim().toLowerCase()
    if (method === 'bank scan' || method === 'aba' || method === 'khqr') {
      bankScan += amount
    } else if (method === 'cash') {
      cash += amount
    } else {
      other += amount
    }
  }

  const split = [
    { name: 'Cash', value: Math.round(cash * 100) / 100, monthKey },
    { name: 'Bank Scan', value: Math.round(bankScan * 100) / 100, monthKey },
  ]
  if (Math.round(other * 100) !== 0) split.push({ name: 'Other', value: Math.round(other * 100) / 100, monthKey })
  return split
}

export function buildDashboardStats(orders, user, todaySpending = 0) {
  const completed = orders.filter((order) => isCompletedStatus(order.status))
  const todayKey = phnomPenhDayKey(new Date())
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
    if (!isCompletedStatus(order.status)) continue
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
    orders.filter((order) => isCompletedStatus(order.status)),
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