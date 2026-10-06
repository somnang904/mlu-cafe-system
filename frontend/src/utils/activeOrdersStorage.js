import { floorTables, TAKEOUT_BILL } from '../data/tables'
import { applyItemsToBill, normalizeBillItem } from './posHelpers'

const STORAGE_KEY = 'mlu_kitchen_cafe.activeOrders'

function statusForItems(items) {
  return items?.length > 0 ? 'occupied' : 'empty'
}

function serializeBill(bill) {
  return {
    id: bill.id,
    name: bill.name,
    isTakeOut: Boolean(bill.isTakeOut),
    status: bill.status,
    orderTotal: bill.orderTotal,
    orderSummary: bill.orderSummary,
    items: (bill.items || []).map((item) => normalizeBillItem({ ...item })),
  }
}

export function readActiveOrdersSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.tables)) return null

    return {
      tables: parsed.tables,
      takeOut: parsed.takeOut ?? TAKEOUT_BILL,
      invoiceCounter: Number.parseInt(parsed.invoiceCounter, 10) || 1043,
      savedAt: parsed.savedAt ?? null,
    }
  } catch {
    return null
  }
}

export function writeActiveOrdersSnapshot({ tables, takeOut, invoiceCounter }) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tables: tables.map(serializeBill),
        takeOut: serializeBill(takeOut),
        invoiceCounter,
        savedAt: new Date().toISOString(),
      }),
    )
  } catch (err) {
    console.error('Failed to persist active orders to localStorage:', err)
  }
}

export function hydrateFromSnapshot(snapshot) {
  if (!snapshot) {
    return {
      tables: floorTables,
      takeOut: TAKEOUT_BILL,
      invoiceCounter: 1043,
    }
  }

  const tables = floorTables.map((table) => {
    const cached = snapshot.tables.find((entry) => entry.id === table.id)
    if (!cached || !cached.items?.length) {
      const preservedStatus = cached?.status === 'paid' ? 'paid' : 'empty'
      return { ...table, status: preservedStatus, items: [], orderSummary: null, orderTotal: null }
    }
    return applyItemsToBill(table, cached.items, statusForItems(cached.items))
  })

  const takeOut =
    snapshot.takeOut?.items?.length > 0
      ? applyItemsToBill(TAKEOUT_BILL, snapshot.takeOut.items, statusForItems(snapshot.takeOut.items))
      : TAKEOUT_BILL

  return {
    tables,
    takeOut,
    invoiceCounter: snapshot.invoiceCounter ?? 1043,
  }
}

export function groupActiveRows(activeOrderRows) {
  if (!activeOrderRows?.length) return {}
  const linesByKey = new Map()

  return activeOrderRows.reduce((acc, row) => {
    const targetKey = row.target_id != null ? String(row.target_id).trim() : 'takeout'
    if (!acc[targetKey]) acc[targetKey] = []

    const notes = row.notes != null ? String(row.notes) : ''
    const qty = parseInt(row.quantity || 0, 10)
    const unitPrice = parseFloat(row.price || 0)
    const lineId = `${row.menu_item_id ?? row.name}::${notes}`
    const sameLines = linesByKey.get(`${targetKey}|${lineId}`) || []
    const existing = sameLines.find((item) => item.unitPrice === unitPrice)
    if (existing) {
      existing.qty += qty
      existing.quantity = existing.qty
      existing.lineTotal = existing.qty * existing.unitPrice
    } else {
      const line = normalizeBillItem({
        id: sameLines.length ? `${lineId}::${unitPrice.toFixed(2)}` : lineId,
        menu_item_id: row.menu_item_id,
        name: row.name,
        notes,
        qty,
        unitPrice,
      })
      linesByKey.set(`${targetKey}|${lineId}`, [...sameLines, line])
      acc[targetKey].push(line)
    }
    return acc
  }, {})
}

export function reconcileActiveOrders(prevTables, prevTakeOut, groupedOrders) {
  const tables = prevTables.map((table) => {
    const serverItems = groupedOrders?.[table.id.toString()]

    if (serverItems?.length) {
      return applyItemsToBill(table, serverItems, statusForItems(serverItems))
    }
    if (table.status === 'paid' && !table.items?.length) {
      return table
    }
    return {
      ...table,
      status: 'empty',
      orderSummary: null,
      orderTotal: null,
      items: [],
    }
  })

  const serverTakeout = groupedOrders?.takeout
  const takeOut = serverTakeout?.length
    ? applyItemsToBill(TAKEOUT_BILL, serverTakeout, statusForItems(serverTakeout))
    : prevTakeOut.status === 'paid' && !prevTakeOut.items?.length
      ? prevTakeOut
      : TAKEOUT_BILL

  return { tables, takeOut }
}
