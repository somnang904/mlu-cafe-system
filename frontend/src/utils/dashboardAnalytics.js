import { formatDateTimeDisplay, formatOrderDate, sortOrdersByDateTime } from './dateTimeFormat'

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

  const dayMap = Object.fromEntries(days.map((day) => [day.key, day]))

  for (const order of orders) {
    if (order.status && order.status !== 'Completed') continue
    const dateKey = order.date
    if (!dateKey || !dayMap[dateKey]) continue
    dayMap[dateKey].revenue += Number.parseFloat(order.total || 0)
  }

  return days.map((day) => ({
    ...day,
    revenue: Math.round(day.revenue * 100) / 100,
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
    if (order.status && order.status !== 'Completed') continue
    if (!String(order.date || '').startsWith(monthKey)) continue
    const total = Number.parseFloat(order.total || 0)
    const method = order.payment_method || order.payment || 'Cash'
    if (method === 'Bank Scan') {
      bankScan += total
    } else {
      cash += total
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
  const todayOrders = completed.filter((order) => order.date === todayKey)
  const todayRevenue = todayOrders.reduce(
    (sum, order) => sum + Number.parseFloat(order.total || 0),
    0,
  )
  const spending = Number(todaySpending) || 0
  const netProfit = Math.round((todayRevenue - spending) * 100) / 100

  return {
    todayRevenue: Math.round(todayRevenue * 100) / 100,
    todaySpending: Math.round(spending * 100) / 100,
    netProfit,
    todayOrderCount: todayOrders.length,
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