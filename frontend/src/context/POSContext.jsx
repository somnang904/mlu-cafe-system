import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import {
  applyItemsToBill,
  buildOrderSummary,
  calculateTotals,
  formatInvoiceId,
  formatNow,
  mergeCartIntoItems,
  normalizeBillItem,
  parseMenuItemId,
} from '../utils/posHelpers'
import { buildSalesHistoryQuery, mapHistoryRow } from '../utils/salesHistoryAnalytics'
import { phnomPenhDayKey } from '../utils/phnomPenhTime'
import {
  readActiveOrdersSnapshot,
  writeActiveOrdersSnapshot,
  hydrateFromSnapshot,
  groupActiveRows,
  reconcileActiveOrders,
} from '../utils/activeOrdersStorage'
import { TAKEOUT_BILL } from '../data/tables'

import { apiFetch, getAuthToken } from '../services/apiClient'
import { readSession } from '../services/sessionStorage'

const POSContext = createContext(null)

/** Brings tables that were merged onto `hostId` back to the floor (mirrors the server). */
function releaseMergedTables(tables, hostId) {
  return tables.map((t) =>
    t.mergedInto != null && String(t.mergedInto) === String(hostId)
      ? { ...t, mergedInto: null, status: 'empty', items: [], orderSummary: null, orderTotal: null }
      : t,
  )
}

function statusForTarget(items) {
  return items.length > 0 ? 'occupied' : 'empty'
}

function getInitialState() {
  const snapshot = readActiveOrdersSnapshot()
  return hydrateFromSnapshot(snapshot)
}

function buildOrderTargetPayload(destinationId) {
  if (destinationId === 'takeout') {
    return { target_id: 'takeout', table_id: null }
  }

  const tableNumber = Number.parseInt(String(destinationId), 10)
  return {
    target_id: destinationId,
    table_id: Number.isNaN(tableNumber) ? null : tableNumber,
  }
}

function mapBillItemsForApi(items) {
  return items.map((item) => {
    return {
      menu_item_id: parseMenuItemId(item.menu_item_id ?? item.id),
      name: item.name,
      notes: item.notes || '',
      serving: item.serving || null,
      quantity: item.qty,
      price: item.unitPrice,
    }
  })
}

function serverBillItems(targetId, lines) {
  if (!Array.isArray(lines)) return null
  return groupActiveRows(lines)[String(targetId)] || []
}

async function postOrderToServer(destinationId, safeCartItems) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...buildOrderTargetPayload(destinationId),
      items: mapBillItemsForApi(safeCartItems),
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.detail || data.message || `Server status returned ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

export function POSProvider({ children }) {
  const initialState = getInitialState()
  const [tables, setTables] = useState(initialState.tables)
  const [takeOut, setTakeOut] = useState(initialState.takeOut)
  const [salesHistory, setSalesHistory] = useState([])
  const [invoiceCounter, setInvoiceCounter] = useState(initialState.invoiceCounter)
  const [paymentTargetId, setPaymentTargetId] = useState(null)
  const [orderTargetId, setOrderTargetId] = useState(null)
  const navigateRef = useRef(null)
  const tablesRef = useRef(initialState.tables)
  const takeOutRef = useRef(initialState.takeOut)
  const syncRef = useRef({ inFlight: 0, epoch: 0, refreshPending: false })
  const saveQueueRef = useRef(new Map())
  const refreshActiveOrdersRef = useRef(null)
  const historyScopeRef = useRef(null)
  const historyRequestRef = useRef(0)

  const beginSync = useCallback(() => {
    const sync = syncRef.current
    sync.inFlight += 1
    sync.epoch += 1
    return () => {
      sync.inFlight -= 1
      sync.epoch += 1
      if (sync.inFlight === 0 && sync.refreshPending) {
        sync.refreshPending = false
        refreshActiveOrdersRef.current?.()
      }
    }
  }, [])

  // Mirrored into refs so async handlers read current floor state without re-subscribing.
  useEffect(() => {
    tablesRef.current = tables
    takeOutRef.current = takeOut
  }, [tables, takeOut])

  const registerNavigate = useCallback((fn) => {
    navigateRef.current = fn
  }, [])

  const openPaymentFor = useCallback((targetId) => {
    setPaymentTargetId(targetId)
    navigateRef.current?.('payment')
  }, [])

  const openOrderFor = useCallback((targetId) => {
    setOrderTargetId(targetId)
    navigateRef.current?.('order')
  }, [])

  const clearOrderTarget = useCallback(() => {
    setOrderTargetId(null)
  }, [])

  const clearPaymentTarget = useCallback(() => {
    setPaymentTargetId(null)
  }, [])

  const loadSalesHistory = useCallback(async (options) => {
    const token = getAuthToken()
    if (!token) return null

    if (options !== undefined) historyScopeRef.current = options
    const requestId = ++historyRequestRef.current
    const isStale = () => requestId !== historyRequestRef.current

    try {
      const query = buildSalesHistoryQuery(options !== undefined ? options : historyScopeRef.current ?? undefined)
      const response = await apiFetch(`/orders/history?${query}`, { token })
      if (isStale()) return null
      if (response.status === 401) return null
      // Staff without Sales, or any permission ceiling miss: keep Order/Payment working.
      if (response.status === 403 || response.status === 400) {
        setSalesHistory([])
        return []
      }
      if (!response.ok) {
        setSalesHistory([])
        return []
      }
      const historyRows = await response.json()
      if (isStale()) return null

      if (historyRows && Array.isArray(historyRows)) {
        const formattedHistory = historyRows.map(mapHistoryRow)
        setSalesHistory(formattedHistory)
        return formattedHistory
      }
    } catch (err) {
      console.error('Error loading historical database entries:', err)
      if (!isStale()) setSalesHistory([])
    }
    return null
  }, [])

  const releaseSalesHistoryScope = useCallback(() => {
    historyScopeRef.current = null
    return loadSalesHistory()
  }, [loadSalesHistory])

  const refreshFloorTables = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const res = await apiFetch('/tables', { token })
      if (!res.ok) return
      const data = await res.json()
      if (data?.tables && Array.isArray(data.tables)) {
        setTables((prev) => {
          const prevById = new Map(prev.map((t) => [String(t.id), t]))
          return data.tables.map((st) => {
            const key = String(st.id)
            const existing = prevById.get(key)
            if (existing) {
              const serverStatus = String(st.status || '').toLowerCase()
              const preservedStatus =
                existing.items?.length > 0
                  ? existing.status || 'occupied'
                  : existing.status === 'paid' || serverStatus === 'paid'
                    ? 'paid'
                    : 'empty'
              return {
                ...existing,
                name: st.name || existing.name,
                section: st.section || existing.section,
                capacity: Number(st.capacity) || existing.capacity || 4,
                status: preservedStatus,
                mergedInto: st.mergedInto ?? null,
              }
            }
            return {
              id: st.id,
              name: st.name,
              isTakeOut: false,
              section: st.section || 'standard',
              capacity: Number(st.capacity) || 4,
              status: String(st.status || '').toLowerCase() === 'paid' ? 'paid' : 'empty',
              mergedInto: st.mergedInto ?? null,
              orderTotal: null,
              orderSummary: null,
              items: [],
            }
          })
        })
      }
    } catch (err) {
      console.error('Failed refreshing floor tables:', err)
    }
  }, [])

  const addTable = useCallback(async ({ name, section, capacity }) => {
    const token = getAuthToken()
    const response = await apiFetch('/tables', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, section, capacity }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.message || 'Failed to create table')
    }
    await refreshFloorTables()
    return data.table
  }, [refreshFloorTables])

  const updateTable = useCallback(async (id, { name, section, capacity }) => {
    const token = getAuthToken()
    const response = await apiFetch(`/tables/${id}`, {
      method: 'PUT',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, section, capacity }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.message || 'Failed to update table')
    }
    await refreshFloorTables()
    return data.table
  }, [refreshFloorTables])

  const deleteTable = useCallback(async (id) => {
    const token = getAuthToken()
    const response = await apiFetch(`/tables/${id}`, {
      method: 'DELETE',
      token,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.message || 'Failed to delete table')
    }
    await refreshFloorTables()
    return true
  }, [refreshFloorTables])

  const transferTable = useCallback(async (fromId, toId) => {
    const token = getAuthToken()
    const endSync = beginSync()
    let response
    let data
    try {
      response = await apiFetch('/tables/transfer', {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_table_id: fromId, to_table_id: toId }),
      })
      data = await response.json().catch(() => ({}))
    } finally {
      endSync()
    }
    if (!response.ok) {
      throw new Error(data.message || 'Failed to transfer table')
    }

    setTables((prev) => {
      const fromTable = prev.find((t) => t.id === fromId)
      if (!fromTable) return prev

      return prev.map((t) => {
        if (t.id === fromId) {
          return {
            ...t,
            status: 'empty',
            items: [],
            orderSummary: null,
            orderTotal: null,
          }
        }
        if (t.id === toId) {
          return {
            ...t,
            status: fromTable.status,
            items: [...fromTable.items],
            orderSummary: fromTable.orderSummary,
            orderTotal: fromTable.orderTotal,
          }
        }
        if (t.mergedInto === fromId) {
          return { ...t, mergedInto: toId }
        }
        return t
      })
    })

    return data
  }, [beginSync])

  const clearTable = useCallback(async (targetId) => {
    const token = getAuthToken()
    const endSync = beginSync()
    let response
    let data
    try {
      response = await apiFetch(`/tables/${targetId}/clear`, {
        method: 'POST',
        token,
      })
      data = await response.json().catch(() => ({}))
    } finally {
      endSync()
    }
    if (!response.ok) {
      throw new Error(data.message || 'Failed to clear table')
    }

    if (targetId === 'takeout') {
      setTakeOut({
        ...TAKEOUT_BILL,
        status: 'empty',
        items: [],
        orderSummary: null,
        orderTotal: null,
      })
    } else {
      setTables((prev) =>
        releaseMergedTables(
          prev.map((t) =>
            String(t.id) === String(targetId)
              ? {
                  ...t,
                  status: 'empty',
                  items: [],
                  orderSummary: null,
                  orderTotal: null,
                }
              : t,
          ),
          targetId,
        ),
      )
    }

    return data
  }, [beginSync])

  useEffect(() => {
    writeActiveOrdersSnapshot({ tables, takeOut, invoiceCounter })
  }, [tables, takeOut, invoiceCounter])

  useEffect(() => {
    refreshFloorTables()
  }, [refreshFloorTables])

  const refreshActiveOrders = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    const sync = syncRef.current
    if (sync.inFlight > 0) {
      sync.refreshPending = true
      return
    }
    const startEpoch = sync.epoch

    try {
      const res = await apiFetch('/orders/active', { token })
      if (!res.ok) return
      const activeOrderRows = await res.json()
      if (!activeOrderRows || !Array.isArray(activeOrderRows)) return
      if (sync.epoch !== startEpoch) {
        sync.refreshPending = true
        if (sync.inFlight === 0) {
          sync.refreshPending = false
          refreshActiveOrdersRef.current?.()
        }
        return
      }

      const groupedOrders = groupActiveRows(activeOrderRows)
      const reconciled = reconcileActiveOrders(
        tablesRef.current,
        takeOutRef.current,
        groupedOrders,
      )
      setTables(reconciled.tables)
      setTakeOut(reconciled.takeOut)
    } catch {
      // Background poll: the next refresh retries, so a failed fetch is not surfaced.
    }
  }, [])

  useEffect(() => {
    refreshActiveOrdersRef.current = refreshActiveOrders
  }, [refreshActiveOrders])

  useEffect(() => {
    const interval = window.setInterval(refreshActiveOrders, 15_000)
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') refreshActiveOrders()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [refreshActiveOrders])

  useEffect(() => {
    refreshActiveOrders()
    loadSalesHistory()

    let channel
    try {
      channel = new BroadcastChannel('mlu-pos-sync')
      channel.onmessage = () => {
        refreshActiveOrders()
        loadSalesHistory()
      }
    } catch {
      // BroadcastChannel is missing in some browsers; cross-tab sync is optional.
    }

    return () => {
      if (channel) channel.close()
    }
  }, [refreshActiveOrders, loadSalesHistory])

  const getBillById = (id) => {
    if (id === 'takeout') return takeOut
    return tables.find((table) => table.id === id) ?? null
  }

  const getActiveBills = useCallback(() => {
    const tableBills = tables.filter(
      (table) => table.status !== 'empty' && table.status !== 'paid' && table.items?.length > 0,
    )
    const bills = [...tableBills]
    if (takeOut.status !== 'empty' && takeOut.status !== 'paid' && takeOut.items?.length > 0) {
      bills.push(takeOut)
    }
    return bills.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }, [tables, takeOut])

  const assignmentTargets = [
    ...tables.filter((table) => table.mergedInto == null).map((table) => ({
      id: table.id,
      name: table.name,
      status: table.status,
      section: table.section || 'standard',
      isTakeOut: false,
    })),
    {
      id: takeOut.id,
      name: takeOut.name,
      status: takeOut.status,
      isTakeOut: true,
    },
  ]

  const persistBillItems = (targetId, items, baseItems) => {
    const key = String(targetId)
    const endSync = beginSync()
    const previous = saveQueueRef.current.get(key) || Promise.resolve()
    const save = previous
      .catch(() => {})
      .then(async () => {
        const response = await apiFetch('/orders/items', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...buildOrderTargetPayload(targetId),
            items: mapBillItemsForApi(items),
            base_items: mapBillItemsForApi(baseItems),
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.detail || data.message || `Server status returned ${response.status}`)
        }
        return data
      })
    const tracked = save
      .then((data) => {
        const savedItems = serverBillItems(targetId, data?.lines)
        if (savedItems?.length && saveQueueRef.current.get(key) === tracked) {
          updateBillState(targetId, savedItems, statusForTarget(savedItems))
        }
        return data
      })
      .finally(() => {
        if (saveQueueRef.current.get(key) === tracked) saveQueueRef.current.delete(key)
        endSync()
      })
    saveQueueRef.current.set(key, tracked)
    return tracked.catch((err) => {
      refreshActiveOrders()
      throw err
    })
  }

  const updateBillState = (destinationId, items, statusOverride) => {
    if (destinationId === 'takeout') {
      setTakeOut((prev) => applyItemsToBill(prev, items, statusOverride))
    } else {
      setTables((prev) => {
        const next = prev.map((table) =>
          table.id === destinationId ? applyItemsToBill(table, items, statusOverride) : table,
        )
        return items.length === 0 ? releaseMergedTables(next, destinationId) : next
      })
    }
  }

  const assignOrder = async (destinationId, cartItems) => {
    if (!cartItems.length) return { ok: false, message: null }

    const safeCartItems = cartItems.map((item) =>
      normalizeBillItem({
        id: item.id,
        menu_item_id: item.menu_item_id ?? item.id,
        name: item.name,
        notes: item.notes || '',
        qty: item.qty || item.quantity || 1,
        unitPrice: item.unitPrice || item.price || 0,
        serving: item.serving || null,
      }),
    )

    const updateBill = (bill) => {
      const mergedItems = mergeCartIntoItems(bill.items, safeCartItems)
      const finalizedItems = mergedItems.map(normalizeBillItem)
      const status = statusForTarget(finalizedItems)
      return applyItemsToBill(bill, finalizedItems, status)
    }

    const endSync = beginSync()
    let savedItems
    try {
      const data = await postOrderToServer(destinationId, safeCartItems)
      savedItems = serverBillItems(destinationId, data?.lines)
    } catch (err) {
      endSync()
      console.error('Failed to log order to MySQL:', err.message)
      const rejected = Number.isInteger(err.status) && err.status !== 503
      return { ok: false, message: rejected ? err.message : null }
    }

    if (savedItems?.length) {
      updateBillState(destinationId, savedItems, statusForTarget(savedItems))
    } else if (destinationId === 'takeout') {
      setTakeOut((prev) => updateBill(prev))
    } else {
      setTables((prev) =>
        prev.map((table) => (table.id === destinationId ? updateBill(table) : table)),
      )
    }
    endSync()

    return { ok: true, message: null }
  }

  const updateBillItems = (destinationId, items) => {
    const status = statusForTarget(items)
    const baseItems = getBillById(destinationId)?.items || []
    if (items.length === 0) {
      persistBillItems(destinationId, items, baseItems)
        .then(() => updateBillState(destinationId, items, status))
        .catch((err) => {
          console.error('Failed to clear bill items:', err.message)
        })
      return
    }
    updateBillState(destinationId, items, status)
    persistBillItems(destinationId, items, baseItems).catch((err) => {
      console.error('Failed to sync bill items:', err.message)
    })
  }

  const decrementBillItem = (destinationId, itemId) => {
    const bill = getBillById(destinationId)
    if (!bill) return

    const nextItems = bill.items
      .map((item) => {
        if (item.id !== itemId) return item
        const nextQty = item.qty - 1
        if (nextQty <= 0) return null
        return normalizeBillItem({ ...item, qty: nextQty })
      })
      .filter(Boolean)

    updateBillItems(destinationId, nextItems)
  }

  const updateBillItemPrice = (destinationId, itemId, newPrice) => {
    const bill = getBillById(destinationId)
    if (!bill) return

    const price = Math.max(0, parseFloat(newPrice) || 0)
    const nextItems = bill.items.map((item) =>
      item.id === itemId ? normalizeBillItem({ ...item, unitPrice: price }) : item,
    )
    updateBillItems(destinationId, nextItems)
  }

  const processPayment = async (
    destinationId,
    paymentMethod = 'Cash',
    clearImmediately = true,
    paymentDetails = {},
  ) => {
    const bill = getBillById(destinationId)
    if (!bill || bill.items.length === 0) return null

    const { subtotal, tax, total } = calculateTotals(bill.items)
    const { date, time } = formatNow()
    const endSync = beginSync()

    try {
      await persistBillItems(destinationId, bill.items, bill.items)

      const response = await apiFetch('/orders/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildOrderTargetPayload(destinationId),
          payment_method: paymentMethod,
          payment_bank: paymentMethod === 'Bank Scan' ? paymentDetails.payment_bank ?? null : null,
          clear_table: clearImmediately,
          subtotal,
          tax,
          total,
          received_usd: paymentDetails.received_usd ?? null,
          received_khr: paymentDetails.received_khr ?? null,
          change_usd: paymentDetails.change_usd ?? null,
          change_khr: paymentDetails.change_khr ?? null,
          exchange_rate: paymentDetails.exchange_rate ?? null,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.detail || data.message || `Server status returned ${response.status}`)
      }

      const invoiceId = data.invoice_id || formatInvoiceId(invoiceCounter)
      const recordedTotal = Number.isFinite(Number(data.total)) ? Number(data.total) : total
      const recordedItems = serverBillItems(destinationId, data.lines)
      const paidItems = recordedItems?.length ? recordedItems : bill.items

      const currentUser = readSession()?.user
      const staffName = data.staff_name || currentUser?.display_name || currentUser?.username || null
      const staffId = data.staff_id || currentUser?.id || null

      const transaction = {
        id: invoiceId,
        staff_id: staffId,
        staff_name: staffName,
        cashier: staffName,
        date,
        time,
        monthKey: date.slice(0, 7),
        payment: paymentMethod,
        payment_bank: paymentMethod === 'Bank Scan' ? data.payment_bank ?? paymentDetails.payment_bank ?? null : null,
        subtotal: Number.isFinite(Number(data.subtotal)) ? Number(data.subtotal) : subtotal,
        tax: Number.isFinite(Number(data.tax)) ? Number(data.tax) : tax,
        total: recordedTotal,
        status: 'Completed',
        source: bill.name,
        summary: recordedItems?.length ? buildOrderSummary(recordedItems) : bill.orderSummary,
        items: paidItems.map((item) => ({ ...item })),
        lowStockItems: Array.isArray(data.low_stock_items) ? data.low_stock_items : [],
        received_usd: data.received_usd ?? paymentDetails.received_usd ?? null,
        received_khr: data.received_khr ?? paymentDetails.received_khr ?? null,
        change_usd: data.change_usd ?? paymentDetails.change_usd ?? null,
        change_khr: data.change_khr ?? paymentDetails.change_khr ?? null,
        exchange_rate: data.exchange_rate ?? paymentDetails.exchange_rate ?? null,
      }

      setSalesHistory((prev) => [transaction, ...prev])
      loadSalesHistory().catch((err) => {
        console.error('Failed to refresh sales history after checkout:', err.message)
      })
      setInvoiceCounter((prev) => prev + 1)

      // Notify all tabs and in-page listeners immediately for Realtime sync
      try {
        const channel = new BroadcastChannel('mlu-pos-sync')
        channel.postMessage({ type: 'order-checkout', id: invoiceId })
        channel.close()
      } catch {
        // BroadcastChannel is missing in some browsers; cross-tab sync is optional.
      }
      window.dispatchEvent(new CustomEvent('mlu-order-completed', { detail: transaction }))

      if (clearImmediately) {
        const cleared = applyItemsToBill(bill, [])
        if (destinationId === 'takeout') {
          setTakeOut(cleared)
        } else {
          setTables((prev) =>
            releaseMergedTables(
              prev.map((table) => (table.id === destinationId ? cleared : table)),
              destinationId,
            ),
          )
        }
      } else {
        const markedPaid = {
          ...bill,
          items: [],
          orderTotal: null,
          orderSummary: null,
          status: 'paid',
        }
        if (destinationId === 'takeout') {
          setTakeOut(markedPaid)
        } else {
          setTables((prev) => prev.map((table) => (table.id === destinationId ? markedPaid : table)))
        }
      }

      return transaction
    } catch (err) {
      console.error('Failed logging transaction payment:', err.message)
      return { error: err.message || 'Payment failed' }
    } finally {
      endSync()
    }
  }

  const processSplitPayment = async (
    destinationId,
    splitItems,
    paymentMethod = 'Cash',
    clearImmediately = false,
    paymentDetails = {},
  ) => {
    const bill = getBillById(destinationId)
    if (!bill || !splitItems?.length) return null

    const splitTotal = Math.round(
      splitItems.reduce((sum, item) => sum + (Number(item.qty || 1) * Number(item.unitPrice || 0)), 0) * 100
    ) / 100
    const { date, time } = formatNow()

    try {
      const response = await apiFetch('/orders/split-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildOrderTargetPayload(destinationId),
          items: splitItems,
          payment_method: paymentMethod,
          payment_bank: paymentMethod === 'Bank Scan' ? paymentDetails.payment_bank ?? null : null,
          clear_table: clearImmediately,
          received_usd: paymentDetails.received_usd ?? null,
          received_khr: paymentDetails.received_khr ?? null,
          change_usd: paymentDetails.change_usd ?? null,
          change_khr: paymentDetails.change_khr ?? null,
          exchange_rate: paymentDetails.exchange_rate ?? null,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.detail || data.message || `Server status returned ${response.status}`)
      }

      const invoiceId = data.invoice_id || formatInvoiceId(invoiceCounter)
      const recordedTotal = Number.isFinite(Number(data.split_total)) ? Number(data.split_total) : splitTotal
      const recordedItems = serverBillItems(destinationId, data.lines)
      const paidItems = recordedItems?.length ? recordedItems : splitItems

      const transaction = {
        id: invoiceId,
        date,
        time,
        monthKey: date.slice(0, 7),
        payment: paymentMethod,
        payment_bank: paymentMethod === 'Bank Scan' ? data.payment_bank ?? paymentDetails.payment_bank ?? null : null,
        subtotal: recordedTotal,
        tax: 0,
        total: recordedTotal,
        status: 'Completed',
        staff_id: (data.staff_id || readSession()?.user?.id) ?? null,
        staff_name: (data.staff_name || readSession()?.user?.display_name || readSession()?.user?.username) ?? null,
        cashier: (data.staff_name || readSession()?.user?.display_name || readSession()?.user?.username) ?? null,
        source: `${bill.name} (Split)`,
        summary: paidItems.map((it) => `${it.qty}× ${it.name}`).join(', '),
        items: paidItems.map((item) => ({ ...item })),
        lowStockItems: Array.isArray(data.low_stock_items) ? data.low_stock_items : [],
        received_usd: data.received_usd ?? paymentDetails.received_usd ?? null,
        received_khr: data.received_khr ?? paymentDetails.received_khr ?? null,
        change_usd: data.change_usd ?? paymentDetails.change_usd ?? null,
        change_khr: data.change_khr ?? paymentDetails.change_khr ?? null,
        exchange_rate: data.exchange_rate ?? paymentDetails.exchange_rate ?? null,
      }

      setSalesHistory((prev) => [transaction, ...prev])
      loadSalesHistory().catch(() => {})
      setInvoiceCounter((prev) => prev + 1)

      // Calculate remaining bill items
      const updatedBillItems = []
      const remainingDeductions = new Map()
      for (const splitItem of splitItems) {
        const key = String(splitItem.id)
        remainingDeductions.set(key, (remainingDeductions.get(key) || 0) + Number(splitItem.qty || 1))
      }

      for (const item of bill.items) {
        const key = String(item.id)
        const toDeduct = remainingDeductions.get(key) || 0
        if (toDeduct > 0) {
          const newQty = item.qty - toDeduct
          if (newQty > 0) {
            updatedBillItems.push({
              ...item,
              qty: newQty,
              quantity: newQty,
              lineTotal: newQty * item.unitPrice,
            })
            remainingDeductions.set(key, 0)
          } else {
            remainingDeductions.set(key, toDeduct - item.qty)
          }
        } else {
          updatedBillItems.push({ ...item })
        }
      }

      if (updatedBillItems.length === 0) {
        if (clearImmediately) {
          const cleared = applyItemsToBill(bill, [])
          if (destinationId === 'takeout') setTakeOut(cleared)
          else
            setTables((prev) =>
              releaseMergedTables(
                prev.map((t) => (t.id === destinationId ? cleared : t)),
                destinationId,
              ),
            )
        } else {
          const markedPaid = { ...bill, items: [], status: 'paid' }
          if (destinationId === 'takeout') setTakeOut(markedPaid)
          else setTables((prev) => prev.map((t) => (t.id === destinationId ? markedPaid : t)))
        }
      } else {
        updateBillState(destinationId, updatedBillItems, statusForTarget(updatedBillItems))
        refreshActiveOrders()
      }

      try {
        const channel = new BroadcastChannel('mlu-pos-sync')
        channel.postMessage({ type: 'order-checkout', id: invoiceId })
        channel.close()
      } catch {
        // BroadcastChannel is missing in some browsers; cross-tab sync is optional.
      }
      window.dispatchEvent(new CustomEvent('mlu-order-completed', { detail: transaction }))

      return transaction
    } catch (err) {
      console.error('Failed logging split payment:', err.message)
      throw err
    }
  }

  const refundOrder = async (orderId, reason, managerCredentials = {}) => {
    try {
      const response = await apiFetch(`/orders/${orderId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          manager_username: managerCredentials.username,
          manager_password: managerCredentials.password,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || `Server status returned ${response.status}`)
      }

      setSalesHistory((prev) =>
        prev.map((order) =>
          order.order_id === orderId || order.id === data.invoice_id || order.id === orderId
            ? { ...order, status: 'Refunded', void_reason: reason, refundDate: phnomPenhDayKey(new Date()) }
            : order,
        ),
      )

      loadSalesHistory().catch(() => {})
      return data
    } catch (err) {
      console.error('Failed refunding order:', err.message)
      throw err
    }
  }

  const deleteOrder = async (orderId) => {
    try {
      const response = await apiFetch(`/orders/${orderId}`, {
        method: 'DELETE',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || `Server status returned ${response.status}`)
      }

      setSalesHistory((prev) =>
        (prev || []).filter((order) => order.order_id !== orderId && order.id !== orderId),
      )

      loadSalesHistory().catch(() => {})
      return data
    } catch (err) {
      console.error('Failed deleting order:', err.message)
      throw err
    }
  }

  const mergeTables = async (fromTableId, toTableId) => {
    const endSync = beginSync()
    try {
      const response = await apiFetch('/tables/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_table_id: fromTableId,
          to_table_id: toTableId,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || `Server status returned ${response.status}`)
      }

      // Re-fetch active orders to sync floor. reconcileActiveOrders keeps local items it
      // doesn't see on the server, so the two merged tables are set explicitly.
      const activeRes = await apiFetch('/orders/active')
      const grouped = activeRes.ok ? groupActiveRows(await activeRes.json()) : null
      setTables((prevTables) => {
        const fromTable = prevTables.find((t) => t.id === fromTableId)
        const toTable = prevTables.find((t) => t.id === toTableId)
        const serverItems = grouped?.[String(toTableId)]
        const mergedItems = serverItems?.length
          ? serverItems
          : mergeCartIntoItems(toTable?.items || [], fromTable?.items || []).map(normalizeBillItem)
        const base = grouped ? reconcileActiveOrders(prevTables, takeOut, grouped).tables : prevTables

        return base.map((t) => {
          if (t.id === fromTableId) {
            return { ...t, status: 'empty', items: [], orderSummary: null, orderTotal: null, mergedInto: toTableId }
          }
          if (t.mergedInto === fromTableId) {
            return { ...t, mergedInto: toTableId }
          }
          if (t.id === toTableId) {
            return applyItemsToBill(t, mergedItems, statusForTarget(mergedItems))
          }
          return t
        })
      })

      return data
    } catch (err) {
      console.error('Failed merging tables:', err.message)
      throw err
    } finally {
      endSync()
    }
  }

  return (
    <POSContext.Provider
      value={{
        tables,
        takeOut,
        salesHistory,
        loadSalesHistory,
        releaseSalesHistoryScope,
        assignmentTargets,
        paymentTargetId,
        orderTargetId,
        getBillById,
        getActiveBills,
        assignOrder,
        updateBillItems,
        decrementBillItem,
        updateBillItemPrice,
        processPayment,
        processSplitPayment,
        refundOrder,
        deleteOrder,
        mergeTables,
        openPaymentFor,
        openOrderFor,
        clearOrderTarget,
        clearPaymentTarget,
        registerNavigate,
        refreshFloorTables,
        addTable,
        updateTable,
        deleteTable,
        transferTable,
        clearTable,
      }}
    >
      {children}
    </POSContext.Provider>
  )
}

export function usePOS() {
  const context = useContext(POSContext)
  if (!context) {
    throw new Error('usePOS must be used within a POSProvider')
  }
  return context
}
