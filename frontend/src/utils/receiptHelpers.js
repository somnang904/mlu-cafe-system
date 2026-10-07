import i18n from '../i18n'
import { apiFetch } from '../services/apiClient'
import { formatOrderDate, formatTime12Hour } from './dateTimeFormat'
import { getFloorTableLabel } from '../data/tables'

function normalizeItems(items = []) {
  return items.map((item, index) => {
    const qty = Number(item.qty ?? item.quantity ?? 1)
    const unitPrice = Number.parseFloat(item.unitPrice ?? item.price ?? 0)
    const lineTotal = Number.parseFloat(item.lineTotal ?? qty * unitPrice)

    return {
      id: item.id ?? item.menu_item_id ?? index,
      name: item.name,
      notes: item.notes || '',
      qty,
      unitPrice,
      lineTotal,
    }
  })
}

function fallbackItemsFromSummary(summary) {
  if (!summary || summary === 'Items logged') return []

  return summary.split(',').map((part, index) => {
    const trimmed = part.trim()
    const match = trimmed.match(/^(\d+)×\s*(.+)$/)
    if (!match) {
      return {
        id: index,
        name: trimmed,
        qty: 1,
        unitPrice: 0,
        lineTotal: 0,
      }
    }

    return {
      id: index,
      name: match[2].trim(),
      qty: Number.parseInt(match[1], 10),
      unitPrice: 0,
      lineTotal: 0,
    }
  })
}

function formatSource(order) {
  if (order.source) return order.source
  if (order.source_type === 'Take Out' || order.target_id === 'takeout') {
    return 'Take Out'
  }
  if (order.target_id != null) {
    return getFloorTableLabel(order.target_id)
  }
  return '—'
}

export function toReceiptTransaction(order) {
  let items = normalizeItems(order.items)
  if (items.length === 0) {
    items = fallbackItemsFromSummary(order.summary)
  }

  const subtotal =
    order.subtotal != null
      ? Number.parseFloat(order.subtotal)
      : items.reduce((sum, item) => sum + item.lineTotal, 0)
  const tax = 0
  const total = subtotal

  return {
    id: order.id ?? order.invoice_id ?? '—',
    date: formatOrderDate(order.date),
    time: formatTime12Hour(order.time),
    source: formatSource(order),
    payment: order.payment ?? order.payment_method ?? order.payment_type ?? 'Cash',
    payment_bank: order.payment_bank ?? null,
    items,
    subtotal,
    tax,
    total,
  }
}

export async function fetchReceiptTransaction(order) {
  const hasItems = Array.isArray(order.items) && order.items.length > 0
  if (hasItems) {
    return toReceiptTransaction(order)
  }

  try {
    const response = await apiFetch('/orders/history?days=730')
    if (!response.ok) throw new Error(i18n.t('sales.receiptLoadFailed'))
    const rows = await response.json()
    const match = rows.find(
      (row) =>
        row.invoice_id === order.id ||
        String(row.order_id) === String(order.id) ||
        row.invoice_id === order.invoice_id,
    )

    if (match) {
      return toReceiptTransaction({
        id: match.invoice_id || order.id,
        date: match.date || order.date,
        time: formatTime12Hour(match.time || order.time),
        source: order.source,
        payment: match.payment_method || match.payment_type,
        payment_bank: match.payment_bank,
        subtotal: match.subtotal,
        tax: match.tax,
        total: match.total,
        items: match.items,
        summary: match.summary,
        target_id: match.target_id,
        source_type: match.source_type,
      })
    }
  } catch {
    // Fall back to local order data.
  }

  return toReceiptTransaction(order)
}
