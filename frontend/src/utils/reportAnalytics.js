// Reports page figures for an inclusive day range. Same rules as salesHistoryAnalytics:
// a sale counts on its sale day; a refund is subtracted on its refund day.
import {
  getRefundDateKey,
  isRefundedOrder,
  isSoldOrder,
  normalizeOrderDate,
} from './salesHistoryAnalytics'
import { dayKeysBetween, inRange, monthKeysBetween, rangeGrain } from './reportRange'

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function orderTotal(order) {
  return Number.parseFloat(order?.total || 0) || 0
}

function expenseDay(expense) {
  return String(expense?.expense_date || '').slice(0, 10)
}

/** Sold in the range and not refunded since: what really left the kitchen. */
function keptSalesInRange(orders, from, to) {
  return orders.filter(
    (order) => isSoldOrder(order) && !isRefundedOrder(order) && inRange(normalizeOrderDate(order), from, to),
  )
}

export function expensesInRange(expenses, from, to) {
  return (expenses || []).filter((expense) => inRange(expenseDay(expense), from, to))
}

/** KPI figures: sales, refunds, net sales, expenses, net profit (net sales − expenses), orders. */
export function summarizeRange(orders, expenses, from, to) {
  let sales = 0
  let salesOrders = 0
  let refunds = 0
  let refundOrders = 0
  for (const order of orders || []) {
    if (!isSoldOrder(order)) continue
    if (inRange(normalizeOrderDate(order), from, to)) {
      sales += orderTotal(order)
      salesOrders += 1
    }
    if (inRange(getRefundDateKey(order), from, to)) {
      refunds += orderTotal(order)
      refundOrders += 1
    }
  }
  const spending = expensesInRange(expenses, from, to).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
  const net = money(sales - refunds)
  return {
    sales: money(sales),
    refunds: money(refunds),
    net,
    expenses: money(spending),
    profit: money(net - spending),
    orders: salesOrders,
    refundOrders,
  }
}

/** % change from `previous` to `current`; null when there is no base to compare with. */
export function percentChange(current, previous) {
  const base = Number(previous) || 0
  if (!base) return null
  return ((Number(current) || 0) - base) / Math.abs(base) * 100
}

/**
 * Bars for "Income vs spending" / "Sales by day": one per day (short ranges) or per month.
 * `revenue` is net sales, `expenses` is spending — the fields FinanceBarChart reads.
 */
export function buildRangeChart(orders, expenses, from, to, formatLabels) {
  const grain = rangeGrain(from, to)
  const keyLength = grain === 'day' ? 10 : 7
  const keys = grain === 'day' ? dayKeysBetween(from, to) : monthKeysBetween(from, to)
  const buckets = new Map(keys.map((key) => [key, { sales: 0, refunds: 0, expenses: 0, orders: 0 }]))

  for (const order of orders || []) {
    if (!isSoldOrder(order)) continue
    const saleDay = normalizeOrderDate(order)
    if (inRange(saleDay, from, to)) {
      const bucket = buckets.get(saleDay.slice(0, keyLength))
      bucket.sales += orderTotal(order)
      bucket.orders += 1
    }
    const refundDay = getRefundDateKey(order)
    if (inRange(refundDay, from, to)) buckets.get(refundDay.slice(0, keyLength)).refunds += orderTotal(order)
  }
  for (const expense of expensesInRange(expenses, from, to)) {
    buckets.get(expenseDay(expense).slice(0, keyLength)).expenses += Number(expense.amount) || 0
  }

  return {
    grain,
    points: keys.map((key) => {
      const bucket = buckets.get(key)
      const { label, fullLabel } = formatLabels(key, grain)
      return {
        key,
        label,
        fullLabel,
        revenue: money(bucket.sales - bucket.refunds),
        sales: money(bucket.sales),
        expenses: money(bucket.expenses),
        orders: bucket.orders,
      }
    }),
  }
}

// Stored payment_method values → the buckets the page shows. Bank Scan is ABA/KHQR.
// Cash and ABA/KHQR always show; card (or any other method) only once a sale uses it.
const PAYMENT_GROUPS = { cash: 'cash', 'bank scan': 'bank', aba: 'bank', khqr: 'bank', card: 'card' }
export const PAYMENT_GROUP_ORDER = ['cash', 'bank']

/** Share of sales (amount and orders) per payment method, sales made in the range. */
export function paymentBreakdown(orders, from, to) {
  const groups = new Map(PAYMENT_GROUP_ORDER.map((key) => [key, { key, amount: 0, orders: 0 }]))
  for (const order of orders || []) {
    if (!isSoldOrder(order) || !inRange(normalizeOrderDate(order), from, to)) continue
    const method = String(order.payment_method || order.payment_type || 'Cash').trim()
    const key = PAYMENT_GROUPS[method.toLowerCase()] || method
    if (!groups.has(key)) groups.set(key, { key, label: method, amount: 0, orders: 0 })
    const group = groups.get(key)
    group.amount += orderTotal(order)
    group.orders += 1
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.amount, 0)
  return [...groups.values()].map((group) => ({
    ...group,
    amount: money(group.amount),
    percent: total ? (group.amount / total) * 100 : 0,
  }))
}

/** Per menu item: quantity and revenue from sales kept in the range (refunded bills left out). */
export function itemStats(orders, from, to) {
  const items = new Map()
  for (const order of keptSalesInRange(orders || [], from, to)) {
    for (const line of order.items || []) {
      const name = String(line.base_name || line.name || '').trim() || 'Custom item'
      const key = line.menu_item_id != null ? `id:${line.menu_item_id}` : `name:${name.toLowerCase()}`
      const entry = items.get(key) || { key, name, category: line.category || null, qty: 0, revenue: 0 }
      entry.qty += Number(line.qty) || 0
      entry.revenue += Number(line.lineTotal) || (Number(line.qty) || 0) * (Number(line.unitPrice) || 0)
      items.set(key, entry)
    }
  }
  return [...items.values()].map((entry) => ({ ...entry, revenue: money(entry.revenue) }))
}

/** Items grouped by menu category (custom lines without a category fall under null). */
export function categoryStats(items) {
  const totals = new Map()
  for (const item of items) {
    const key = item.category || null
    const entry = totals.get(key) || { category: key, qty: 0, revenue: 0, items: 0 }
    entry.qty += item.qty
    entry.revenue += item.revenue
    entry.items += 1
    totals.set(key, entry)
  }
  const total = [...totals.values()].reduce((sum, entry) => sum + entry.revenue, 0)
  return [...totals.values()].map((entry) => ({
    ...entry,
    revenue: money(entry.revenue),
    percent: total ? (entry.revenue / total) * 100 : 0,
  }))
}

/** Sales per hour of day (0–23), for "busiest hours". */
export function hourlySales(orders, from, to) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, sales: 0, orders: 0 }))
  for (const order of orders || []) {
    if (!isSoldOrder(order) || !inRange(normalizeOrderDate(order), from, to)) continue
    const hour = Number(order.hour)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue
    hours[hour].sales += orderTotal(order)
    hours[hour].orders += 1
  }
  return hours.map((entry) => ({ ...entry, sales: money(entry.sales) }))
}

/** Refunds made in the range, newest first. */
export function refundsInRange(orders, from, to) {
  return (orders || [])
    .filter((order) => inRange(getRefundDateKey(order), from, to))
    .map((order) => ({
      id: order.order_id ?? order.id,
      invoice: order.invoice_id || null,
      saleDate: normalizeOrderDate(order),
      refundDate: getRefundDateKey(order),
      amount: money(orderTotal(order)),
      method: order.payment_method || order.payment_type || 'Cash',
      reason: order.void_reason || '',
    }))
    .sort((a, b) => (b.refundDate || '').localeCompare(a.refundDate || '') || String(b.id).localeCompare(String(a.id)))
}

/** Orders taken and sales per staff member (orders from before staff were recorded: staff null). */
export function staffStats(orders, from, to) {
  const staff = new Map()
  for (const order of orders || []) {
    if (!isSoldOrder(order) || !inRange(normalizeOrderDate(order), from, to)) continue
    const name = String(order.staff_name || '').trim() || null
    const key = order.staff_id != null ? `id:${order.staff_id}` : `name:${name ?? ''}`
    const entry = staff.get(key) || { key, name, orders: 0, sales: 0, refunds: 0 }
    entry.orders += 1
    entry.sales += orderTotal(order)
    if (isRefundedOrder(order)) entry.refunds += orderTotal(order)
    staff.set(key, entry)
  }
  return [...staff.values()].map((entry) => ({
    ...entry,
    sales: money(entry.sales),
    refunds: money(entry.refunds),
    net: money(entry.sales - entry.refunds),
    average: entry.orders ? money(entry.sales / entry.orders) : 0,
  }))
}
