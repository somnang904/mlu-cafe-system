import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import {
  applyItemsToBill,
  calculateTotals,
  formatInvoiceId,
  formatNow,
  mergeCartIntoItems,
  normalizeBillItem,
} from '../utils/posHelpers'
import { buildSalesHistoryQuery } from '../utils/salesHistoryAnalytics'
import { formatOrderDate, formatTime12Hour } from '../utils/dateTimeFormat'
import {
  readActiveOrdersSnapshot,
  writeActiveOrdersSnapshot,
  hydrateFromSnapshot,
  groupActiveRows,
  reconcileActiveOrders,
} from '../utils/activeOrdersStorage'
import { getFloorTableLabel, TAKEOUT_BILL } from '../data/tables'

import { apiFetch, getAuthToken } from '../services/apiClient'

const POSContext = createContext(null)

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
    const parsedId = Number.parseInt(item.menu_item_id ?? item.id, 10)
    return {
      menu_item_id: Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null,
      name: item.name,
      notes: item.notes || '',
      serving: item.serving || null,
      quantity: item.qty,
      price: item.unitPrice,
    }
  })
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
    throw new Error(data.detail || data.message || `Server status returned ${response.status}`)
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

    try {
      const query = buildSalesHistoryQuery(options)
      const response = await apiFetch(`/orders/history?${query}`, { token })
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

      if (historyRows && Array.isArray(historyRows)) {
        const formattedHistory = historyRows.map((row) => ({
          id: row.invoice_id || row.id,
          date: formatOrderDate(row.date || row.created_at),
          time: formatTime12Hour(row.time || row.created_at),
          monthKey: row.month_key || (row.date ? String(row.date).slice(0, 7) : null),
          payment: row.payment_method || 'Cash',
          subtotal: parseFloat(row.subtotal || 0),
          tax: parseFloat(row.tax || 0),
          total: parseFloat(row.total || 0),
          status: row.status || 'Completed',
          source:
            row.target_id === 'takeout' || row.source_type === 'Take Out'
              ? 'Take Out'
              : getFloorTableLabel(row.target_id),
          summary: row.summary || '',
          items: row.items || [],
        }))
        setSalesHistory(formattedHistory)
        return formattedHistory
      }
    } catch (err) {
      console.error('Error loading historical database entries:', err)
      setSalesHistory([])
    }
    return null
  }, [])

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
              }
            }
            return {
              id: st.id,
              name: st.name,
              isTakeOut: false,
              section: st.section || 'standard',
              capacity: Number(st.capacity) || 4,
              status: String(st.status || '').toLowerCase() === 'paid' ? 'paid' : 'empty',
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

  const transferTable = useCallback(async (fromId, toId) => {
    const token = getAuthToken()
    const response = await apiFetch('/tables/transfer', {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_table_id: fromId, to_table_id: toId }),
    })
    const data = await response.json().catch(() => ({}))
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
        return t
      })
    })

    return data
  }, [])

  const clearTable = useCallback(async (targetId) => {
    const token = getAuthToken()
    const response = await apiFetch(`/tables/${targetId}/clear`, {
      method: 'POST',
      token,
    })
    const data = await response.json().catch(() => ({}))
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
      )
    }

    return data
  }, [])

  useEffect(() => {
    writeActiveOrdersSnapshot({ tables, takeOut, invoiceCounter })
  }, [tables, takeOut, invoiceCounter])

  useEffect(() => {
    refreshFloorTables()
  }, [refreshFloorTables])

  const refreshActiveOrders = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    try {
      const res = await apiFetch('/orders/active', { token })
      if (!res.ok) return
      const activeOrderRows = await res.json()
      if (!activeOrderRows || !Array.isArray(activeOrderRows)) return

      const groupedOrders = groupActiveRows(activeOrderRows)
      const reconciled = reconcileActiveOrders(
        tablesRef.current,
        takeOutRef.current,
        groupedOrders,
      )
      setTables(reconciled.tables)
      setTakeOut(reconciled.takeOut)
    } catch (_) {
      // Background retry
    }
  }, [])

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
    } catch (_) {}

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
    ...tables.map((table) => ({
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

  const persistBillItems = async (targetId, items) => {
    const response = await apiFetch('/orders/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...buildOrderTargetPayload(targetId),
        items: mapBillItemsForApi(items),
      }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.detail || data.message || `Server status returned ${response.status}`)
    }
  }

  const updateBillState = (destinationId, items, statusOverride) => {
    if (destinationId === 'takeout') {
      setTakeOut((prev) => applyItemsToBill(prev, items, statusOverride))
    } else {
      setTables((prev) =>
        prev.map((table) =>
          table.id === destinationId ? applyItemsToBill(table, items, statusOverride) : table,
        ),
      )
    }
  }

  const assignOrder = async (destinationId, cartItems) => {
    if (!cartItems.length) return false

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

    try {
      await postOrderToServer(destinationId, safeCartItems)
    } catch (err) {
      console.error('Failed to log order to MySQL:', err.message)
      return false
    }

    if (destinationId === 'takeout') {
      setTakeOut((prev) => updateBill(prev))
    } else {
      setTables((prev) =>
        prev.map((table) => (table.id === destinationId ? updateBill(table) : table)),
      )
    }

    return true
  }

  const updateBillItems = (destinationId, items) => {
    const status = statusForTarget(items)
    if (items.length === 0) {
      persistBillItems(destinationId, items)
        .then(() => updateBillState(destinationId, items, status))
        .catch((err) => {
          console.error('Failed to clear bill items:', err.message)
        })
      return
    }
    updateBillState(destinationId, items, status)
    persistBillItems(destinationId, items).catch((err) => {
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

    try {
      await persistBillItems(destinationId, bill.items)

      const response = await apiFetch('/orders/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildOrderTargetPayload(destinationId),
          payment_method: paymentMethod,
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

      const transaction = {
        id: invoiceId,
        date,
        time,
        monthKey: date.slice(0, 7),
        payment: paymentMethod,
        subtotal,
        tax,
        total,
        status: 'Completed',
        source: bill.name,
        summary: bill.orderSummary,
        items: bill.items.map((item) => ({ ...item })),
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
      } catch (_) {}
      window.dispatchEvent(new CustomEvent('mlu-order-completed', { detail: transaction }))

      if (clearImmediately) {
        const cleared = applyItemsToBill(bill, [])
        if (destinationId === 'takeout') {
          setTakeOut(cleared)
        } else {
          setTables((prev) => prev.map((table) => (table.id === destinationId ? cleared : table)))
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
      return null
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

      const transaction = {
        id: invoiceId,
        date,
        time,
        monthKey: date.slice(0, 7),
        payment: paymentMethod,
        subtotal: splitTotal,
        tax: 0,
        total: splitTotal,
        status: 'Completed',
        source: `${bill.name} (Split)`,
        summary: splitItems.map((it) => `${it.qty}× ${it.name}`).join(', '),
        items: splitItems.map((item) => ({ ...item })),
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
        const key = `${splitItem.menu_item_id ?? splitItem.id}::${splitItem.notes || ''}`
        remainingDeductions.set(key, (remainingDeductions.get(key) || 0) + Number(splitItem.qty || 1))
      }

      for (const item of bill.items) {
        const key = `${item.menu_item_id ?? item.id}::${item.notes || ''}`
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
          else setTables((prev) => prev.map((t) => (t.id === destinationId ? cleared : t)))
        } else {
          const markedPaid = { ...bill, items: [], status: 'paid' }
          if (destinationId === 'takeout') setTakeOut(markedPaid)
          else setTables((prev) => prev.map((t) => (t.id === destinationId ? markedPaid : t)))
        }
      } else {
        updateBillItems(destinationId, updatedBillItems)
      }

      try {
        const channel = new BroadcastChannel('mlu-pos-sync')
        channel.postMessage({ type: 'order-checkout', id: invoiceId })
        channel.close()
      } catch (_) {}
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
            ? { ...order, status: 'Refunded', void_reason: reason }
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

  const mergeTables = async (fromTableId, toTableId) => {
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

      // Re-fetch active orders to sync floor
      const activeRes = await apiFetch('/orders/active')
      if (activeRes.ok) {
        const activeRows = await activeRes.json()
        const grouped = groupActiveRows(activeRows)
        setTables((prevTables) => {
          const { tables: synced } = reconcileActiveOrders(prevTables, takeOut, grouped)
          return synced
        })
      }

      return data
    } catch (err) {
      console.error('Failed merging tables:', err.message)
      throw err
    }
  }

  return (
    <POSContext.Provider
      value={{
        tables,
        takeOut,
        salesHistory,
        loadSalesHistory,
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
        mergeTables,
        openPaymentFor,
        openOrderFor,
        clearOrderTarget,
        clearPaymentTarget,
        registerNavigate,
        refreshFloorTables,
        addTable,
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
