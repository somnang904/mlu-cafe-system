import { formatOrderDate, formatTime12Hour } from './dateTimeFormat'
import { lineIdentity } from './sugarLevel'

export function parseMenuItemId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function calculateTotals(items) {
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const tax = 0
  const total = subtotal
  return { subtotal, tax, total }
}

export function buildOrderSummary(items) {
  return items.map((item) => `${item.qty}× ${item.name}`).join(', ')
}

export function mergeCartIntoItems(existingItems, cartItems) {
  const merged = existingItems.map((item) => ({ ...item }))

  for (const cartItem of cartItems) {
    const addQty = cartItem.qty ?? cartItem.quantity ?? 1
    const unitPrice = cartItem.unitPrice ?? cartItem.price ?? 0
    const notes = cartItem.notes != null ? String(cartItem.notes) : ''
    const menuItemId = parseMenuItemId(cartItem.menu_item_id ?? cartItem.id)
    const incomingKey = lineIdentity({
      id: cartItem.id,
      menu_item_id: menuItemId,
      notes,
    })
    const found = merged.find((item) => lineIdentity(item) === incomingKey)
    if (found) {
      found.qty += addQty
      found.quantity = found.qty
      found.lineTotal = found.qty * found.unitPrice
    } else {
      merged.push({
        id: incomingKey,
        menu_item_id: menuItemId,
        name: cartItem.name,
        notes,
        serving: cartItem.serving || null,
        qty: addQty,
        quantity: addQty,
        unitPrice,
        price: unitPrice,
        lineTotal: unitPrice * addQty,
      })
    }
  }

  return merged
}

export function normalizeBillItem(item) {
  const unitPrice = parseFloat(item.unitPrice ?? item.price ?? 0)
  const qty = parseInt(item.qty ?? item.quantity ?? 1, 10)
  const notes = item.notes != null ? String(item.notes) : ''
  const menuItemId = parseMenuItemId(item.menu_item_id ?? item.id)
  const id = item.id != null && String(item.id).includes('::')
    ? item.id
    : lineIdentity({ menu_item_id: menuItemId ?? item.id, notes })

  return {
    ...item,
    id,
    menu_item_id: menuItemId,
    notes,
    qty,
    quantity: qty,
    unitPrice,
    price: unitPrice,
    lineTotal: qty * unitPrice,
  }
}

export function applyItemsToBill(bill, items, statusOverride) {
  if (items.length === 0) {
    return {
      ...bill,
      items: [],
      orderTotal: null,
      orderSummary: null,
      status: 'empty',
    }
  }

  const normalizedItems = items.map(normalizeBillItem)
  const { total } = calculateTotals(normalizedItems)
  const nextStatus = statusOverride ?? (items.length > 0 ? 'occupied' : 'empty')

  return {
    ...bill,
    items: normalizedItems,
    orderTotal: total,
    orderSummary: buildOrderSummary(normalizedItems),
    status: nextStatus,
  }
}

export function formatInvoiceId(counter) {
  return `INV-${counter}`
}

export function formatNow() {
  const now = new Date()
  return {
    date: formatOrderDate(now),
    time: formatTime12Hour(now),
  }
}
