const { formatOrderLineName } = require('./orderTargets')

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100
}

function lineMatches(line, request) {
  const sameNotes = String(line.notes || '') === String(request.notes || '')
  if (!sameNotes) return false
  if (request.menu_item_id != null && line.menu_item_id != null) {
    return Number(line.menu_item_id) === Number(request.menu_item_id)
  }
  if (line.menu_item_id != null || request.menu_item_id != null) return false
  const wanted = String(request.name || '')
  return wanted === String(line.item_name || '') || wanted === formatOrderLineName(line.item_name, line.notes)
}

function planSplitCheckout(originalLines, requested) {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw httpError(400, 'Select at least one item to split')
  }

  const available = new Map(originalLines.map((line) => [line.id, Number(line.quantity)]))
  const taken = new Map()

  for (const request of requested) {
    const qty = Number(request.qty ?? request.quantity ?? 1)
    if (!Number.isInteger(qty) || qty <= 0) {
      throw httpError(400, 'Split quantities must be whole numbers above zero')
    }

    let remaining = qty
    for (const line of originalLines) {
      if (remaining === 0) break
      if (!lineMatches(line, request)) continue
      const free = available.get(line.id)
      if (free <= 0) continue
      const use = Math.min(free, remaining)
      available.set(line.id, free - use)
      taken.set(line.id, (taken.get(line.id) || 0) + use)
      remaining -= use
    }

    if (remaining > 0) {
      const label = request.name || `item ${request.menu_item_id}`
      throw httpError(400, `${label} is not on this order, or more were selected than were ordered`)
    }
  }

  const splitLines = []
  const lineUpdates = []
  const remainingLines = []
  for (const line of originalLines) {
    const used = taken.get(line.id) || 0
    const left = available.get(line.id)
    if (used > 0) {
      splitLines.push({
        menu_item_id: line.menu_item_id,
        item_name: line.item_name,
        quantity: used,
        price: Number(line.price),
        notes: line.notes || '',
      })
      lineUpdates.push({ id: line.id, quantity: left })
    }
    if (left > 0) remainingLines.push({ ...line, quantity: left })
  }

  const splitTotal = roundMoney(splitLines.reduce((sum, line) => sum + line.quantity * line.price, 0))
  return { splitLines, lineUpdates, remainingLines, splitTotal }
}

module.exports = { planSplitCheckout }
