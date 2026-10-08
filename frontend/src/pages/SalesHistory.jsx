import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Eye, Printer, RotateCcw, Search, UserRound, Users } from 'lucide-react'
import ReceiptModal from '../components/pos/ReceiptModal'
import VoidOrderModal from '../components/pos/VoidOrderModal'
import PeriodSwitch from '../components/ui/PeriodSwitch'
import IconSelect from '../components/ui/IconSelect'
import Tooltip from '../components/ui/Tooltip'
import SaleDetailsModal from '../components/sales/SaleDetailsModal'
import PaginationBar from '../components/ui/PaginationBar'
import { apiFetch } from '../services/apiClient'
import { usePOS } from '../context/POSContext'
import { fetchReceiptTransaction } from '../utils/receiptHelpers'
import { cashPaidIn, formatMonthLabel, mapHistoryRow } from '../utils/salesHistoryAnalytics'
import { formatKhr, formatUsd, usdToKhr } from '../utils/currency'
import { addDays, toDayKey } from '../utils/reportRange'
import { weekdayOfDayKey } from '../utils/phnomPenhTime'
import { formatOrderDate, formatTime12Hour } from '../utils/dateTimeFormat'
import PaymentMethodBadge from '../components/common/PaymentMethodBadge'
import StatusBadge from '../components/common/StatusBadge'

const PERIODS = ['day', 'week', 'month', 'year', 'custom']
const PAGE_SIZE = 20
const EMPTY_SUMMARY = { grossRevenue: 0, refunds: 0, netRevenue: 0, ordersFulfilled: 0, ordersRefunded: 0 }
const ICON_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-forest-500'

function pad(value) {
  return String(value).padStart(2, '0')
}

function periodRange(period, anchor, customRange) {
  if (period === 'custom') return customRange
  if (period === 'day') return { from: anchor, to: anchor }
  if (period === 'week') {
    const from = addDays(anchor, -((weekdayOfDayKey(anchor) + 6) % 7))
    return { from, to: addDays(from, 6) }
  }
  const [year, month] = anchor.split('-').map(Number)
  if (period === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` }
  return { from: `${anchor.slice(0, 7)}-01`, to: `${anchor.slice(0, 7)}-${pad(new Date(year, month, 0).getDate())}` }
}

function shiftAnchor(period, anchor, step) {
  if (period === 'day') return addDays(anchor, step)
  if (period === 'week') return addDays(anchor, 7 * step)
  const [year, month] = anchor.split('-').map(Number)
  if (period === 'year') return `${year + step}-01-01`
  const next = new Date(year, month - 1 + step, 1)
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`
}

function periodLabel(period, range, t) {
  if (period === 'month') return formatMonthLabel(range.from.slice(0, 7), t)
  if (period === 'year') return range.from.slice(0, 4)
  return range.from === range.to ? range.from : `${range.from} – ${range.to}`
}

function OrderTotal({ order, align = 'left' }) {
  const paidIn = cashPaidIn(order)
  const dollars = formatUsd(order.total)
  if (paidIn === 'usd') return <span>{dollars}</span>
  const riel = formatKhr(usdToKhr(order.total, order.exchange_rate || undefined))
  return (
    <span className={`inline-flex flex-col leading-tight ${align === 'right' ? 'items-end' : ''}`}>
      <span>{paidIn === 'khr' ? riel : dollars}</span>
      <span className="text-muted text-2xs font-medium">
        {paidIn === 'khr'
          ? dollars
          : `${formatUsd(order.received_usd)} + ${formatKhr(order.received_khr)}`}
      </span>
    </span>
  )
}

const statusStyles = {
  Completed:
    'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/30 ring-1',
  Refunded:
    'bg-red-500/10 text-red-900 ring-red-500/30 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-500/30 ring-1',
}

function statusLabel(status, t) {
  const key = String(status || '').trim().toLowerCase()
  if (key === 'completed') return t('statuses.completed')
  if (key === 'refunded') return t('statuses.refunded')
  return status
}

export default function SalesHistory() {
  const { t } = useTranslation()
  const { refundOrder } = usePOS()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [cashier, setCashier] = useState('all')
  const [cashiers, setCashiers] = useState([])
  const todayKey = toDayKey(new Date())
  const [period, setPeriod] = useState('month')
  const [anchor, setAnchor] = useState(todayKey)
  const [customRange, setCustomRange] = useState(() => ({ from: `${todayKey.slice(0, 7)}-01`, to: todayKey }))
  const [detailsOrder, setDetailsOrder] = useState(null)
  const [receiptTransaction, setReceiptTransaction] = useState(null)
  const [printingOrderId, setPrintingOrderId] = useState(null)
  const [receiptError, setReceiptError] = useState('')
  const [voidTargetOrder, setVoidTargetOrder] = useState(null)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [matching, setMatching] = useState(0)
  const [monthMetrics, setMonthMetrics] = useState(EMPTY_SUMMARY)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const requestRef = useRef(0)

  const range = useMemo(() => periodRange(period, anchor, customRange), [period, anchor, customRange])
  const { from: rangeFrom, to: rangeTo } = range
  const canGoNext = period !== 'custom' && periodRange(period, shiftAnchor(period, anchor, 1), customRange).from <= todayKey
  const pageCount = Math.max(1, Math.ceil(matching / PAGE_SIZE))

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(0)
  }, [rangeFrom, rangeTo, query, cashier])

  const loadPage = useCallback(async () => {
    const requestId = ++requestRef.current
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ from: rangeFrom, to: rangeTo, page: String(page), limit: String(PAGE_SIZE) })
      if (query) params.set('q', query)
      if (cashier !== 'all') params.set('staff', cashier)
      const response = await apiFetch(`/orders/history/page?${params}`)
      const data = await response.json().catch(() => ({}))
      if (requestId !== requestRef.current) return
      if (!response.ok) throw new Error(data.message || t('sales.loadFailed'))
      setRows((data.rows || []).map(mapHistoryRow))
      setMatching(Number(data.total) || 0)
      setCashiers(Array.isArray(data.cashiers) ? data.cashiers : [])
      setMonthMetrics({ ...EMPTY_SUMMARY, ...(data.summary || {}) })
      setLoadError('')
    } catch (error) {
      if (requestId !== requestRef.current) return
      setLoadError(error.message || t('sales.loadFailed'))
    } finally {
      if (requestId === requestRef.current) setIsLoading(false)
    }
  }, [rangeFrom, rangeTo, page, query, cashier, t])

  useEffect(() => {
    loadPage()
    let channel
    try {
      channel = new BroadcastChannel('mlu-pos-sync')
      channel.onmessage = () => loadPage()
    } catch {
      channel = null
    }
    window.addEventListener('mlu-order-completed', loadPage)
    return () => {
      window.removeEventListener('mlu-order-completed', loadPage)
      if (channel) channel.close()
    }
  }, [loadPage])

  const filteredLogs = rows

  const handlePrintReceipt = async (order) => {
    setPrintingOrderId(order.id)
    setReceiptError('')
    try {
      const transaction = await fetchReceiptTransaction(order)
      setReceiptTransaction(transaction)
    } catch (error) {
      console.error('Failed to prepare receipt:', error)
      setReceiptError(t('sales.receiptLoadFailed'))
    } finally {
      setPrintingOrderId(null)
    }
  }

  const handleConfirmVoid = async (orderId, reason, managerCredentials) => {
    await refundOrder(orderId, reason, managerCredentials)
    await loadPage()
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-heading text-lg">{t('nav.salesHistory')}</h3>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </div>
      ) : null}

      {receiptError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {receiptError}
        </div>
      )}

      <div className="space-y-4">
        <div className="surface-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSwitch
              value={period}
              onChange={(next) => {
                setPeriod(next)
                if (next === 'custom') setCustomRange({ from: rangeFrom, to: rangeTo > todayKey ? todayKey : rangeTo })
              }}
              options={PERIODS.map((id) => ({ id, label: t(`sales.periods.${id}`) }))}
            />
            {period === 'custom' ? (
              <>
                <input
                  type="date"
                  value={customRange.from}
                  max={todayKey}
                  aria-label={t('reports.startDate')}
                  onChange={(event) => {
                    const from = event.target.value
                    if (!from) return
                    setCustomRange((current) => ({ from, to: current.to < from ? from : current.to }))
                  }}
                  className="input-field h-10 w-auto rounded-full px-3.5 text-sm shadow-sm"
                />
                <span className="text-muted" aria-hidden>–</span>
                <input
                  type="date"
                  value={customRange.to}
                  min={customRange.from}
                  max={todayKey}
                  aria-label={t('reports.endDate')}
                  onChange={(event) => {
                    const to = event.target.value
                    if (!to) return
                    setCustomRange((current) => ({ from: current.from > to ? to : current.from, to }))
                  }}
                  className="input-field h-10 w-auto rounded-full px-3.5 text-sm shadow-sm"
                />
              </>
            ) : (
              <div className="flex items-center gap-1">
                <Tooltip label={t('sales.previous')}>
                  <button
                    type="button"
                    onClick={() => setAnchor((current) => shiftAnchor(period, current, -1))}
                    aria-label={t('sales.previous')}
                    className={`${ICON_BUTTON} h-10 w-10 bg-white shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-900 dark:ring-zinc-700 dark:hover:bg-zinc-800`}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                </Tooltip>
                <input
                  type="date"
                  value={anchor}
                  max={todayKey}
                  aria-label={t('sales.pickDate')}
                  onChange={(event) => {
                    if (event.target.value) setAnchor(event.target.value)
                  }}
                  className="input-field h-10 w-auto rounded-full px-3.5 text-sm shadow-sm"
                />
                <Tooltip label={t('sales.next')}>
                  <button
                    type="button"
                    disabled={!canGoNext}
                    onClick={() => setAnchor((current) => {
                      const next = shiftAnchor(period, current, 1)
                      return next > todayKey ? todayKey : next
                    })}
                    aria-label={t('sales.next')}
                    className={`${ICON_BUTTON} h-10 w-10 bg-white shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-900 dark:ring-zinc-700 dark:hover:bg-zinc-800`}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </Tooltip>
                {anchor !== todayKey ? (
                  <button
                    type="button"
                    onClick={() => setAnchor(todayKey)}
                    className="ml-1 rounded-full px-3 py-2 text-xs font-semibold text-forest-700 hover:bg-forest-50 dark:text-forest-300 dark:hover:bg-forest-950/40"
                  >
                    {t('sales.today')}
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div className="surface-inset rounded-xl px-4 py-3">
              <p className="text-muted text-xs uppercase tracking-wider">
                {t('sales.period', { defaultValue: 'Period' })}
              </p>
              <p className="text-heading mt-1 text-sm font-semibold">
                {periodLabel(period, range, t)}
              </p>
            </div>
            <div className="surface-inset rounded-xl px-4 py-3">
              <p className="text-muted text-xs uppercase tracking-wider">
                {t('sales.orders', { defaultValue: 'Orders' })}
              </p>
              <p className="text-heading mt-1 text-2xl font-bold tabular-nums">
                {monthMetrics.ordersFulfilled}
              </p>
            </div>
            <div className="surface-inset rounded-xl px-4 py-3">
              <p className="text-muted text-xs uppercase tracking-wider">
                {t('sales.grossRevenue', { defaultValue: 'Gross revenue' })}
              </p>
              <p className="text-heading mt-1 text-2xl font-bold tabular-nums text-forest-600 dark:text-forest-400">
                ${monthMetrics.grossRevenue.toFixed(2)}
              </p>
            </div>
            <div className="surface-inset rounded-xl px-4 py-3">
              <p className="text-muted text-xs uppercase tracking-wider">
                {t('sales.refunds')}
              </p>
              <p className="text-heading mt-1 text-2xl font-bold tabular-nums text-red-700 dark:text-red-300">
                -${monthMetrics.refunds.toFixed(2)}
              </p>
              <p className="text-muted mt-1 text-xs">
                {t('sales.refundedCount', { count: monthMetrics.ordersRefunded })}
              </p>
            </div>
            <div className="surface-inset rounded-xl px-4 py-3">
              <p className="text-muted text-xs uppercase tracking-wider">
                {t('sales.netRevenue')}
              </p>
              <p className="text-heading mt-1 text-2xl font-bold tabular-nums">
                ${monthMetrics.netRevenue.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="table-shell">
          <div className="flex flex-wrap items-center gap-3 border-b border-olive-100/60 p-4 dark:border-olive-800/30">
            <div className="relative min-w-[12rem] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" aria-hidden />
              <input
                type="text"
                placeholder={t('sales.searchPlaceholder', {
                  defaultValue: 'Search by bill, source, payment, or status...',
                })}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            <div className="w-full sm:w-56">
              <IconSelect
                value={cashier}
                options={[
                  { value: 'all', label: t('sales.allCashiers'), icon: Users },
                  ...cashiers.map((entry) => ({ value: String(entry.id), label: entry.name, icon: UserRound })),
                  ...(cashier !== 'all' && !cashiers.some((entry) => String(entry.id) === cashier)
                    ? [{ value: cashier, label: t('sales.cashierNoSales'), icon: UserRound }]
                    : []),
                ]}
                onChange={setCashier}
                className="w-full px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="lg:hidden">
            {filteredLogs.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-stone-500 dark:text-zinc-400">
                {isLoading ? t('common.loading') : t('sales.emptyLogs', {
                  defaultValue: 'No completed orders found for this month and search filter.',
                })}
              </p>
            ) : (
              filteredLogs.map((order) => {
                const sStyle =
                  statusStyles[order.status] ||
                  'bg-stone-50 text-stone-700 ring-1 ring-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700'
                const isPrinting = printingOrderId === order.id
                return (
                  <article key={order.id} className="min-w-0 border-b border-border/60 px-4 py-4 last:border-b-0">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <p className="min-w-0 whitespace-nowrap font-semibold text-forest-600 dark:text-forest-400">
                        {order.id}
                      </p>
                      <PaymentMethodBadge method={order.payment} bank={order.payment_bank} bankOnly />
                    </div>
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-sm">
                      <p className="min-w-0 break-words text-stone-600 dark:text-stone-300">
                        {order.source ?? '—'}
                      </p>
                      {order.staff_name && (
                        <p className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                          {t('sales.cashier', { defaultValue: 'អ្នកលក់' })}: <span className="font-semibold text-stone-800 dark:text-stone-200">{order.staff_name}</span>
                        </p>
                      )}
                    </div>
                    {order.items?.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-sm text-stone-700 dark:text-stone-200">
                        {order.items.map((item, index) => (
                          <li key={index} className="break-words">
                            <span className="font-semibold tabular-nums">{item.qty}×</span> {item.name}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <p className="tabular-nums leading-tight text-stone-600 dark:text-stone-300">
                        <span className="block">{formatOrderDate(order.date)}</span>
                        <span className="block">{formatTime12Hour(order.time)}</span>
                      </p>
                      <p className="font-semibold tabular-nums text-heading"><OrderTotal order={order} align="right" /></p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <StatusBadge className={sStyle}>
                          {statusLabel(order.status, t)}
                        </StatusBadge>
                        {order.status?.toLowerCase() === 'refunded' && order.void_reason && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400 italic">
                            {order.void_reason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
                        <Tooltip label={t('sales.viewItems')} side="left">
                          <button
                            type="button"
                            onClick={() => setDetailsOrder(order)}
                            aria-label={`${t('sales.viewItems')}: ${order.id}`}
                            className={`${ICON_BUTTON} text-slate-600 hover:bg-forest-50 hover:text-forest-700 dark:text-zinc-300 dark:hover:bg-forest-950/50 dark:hover:text-forest-300`}
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('sales.printReceipt')} side="left">
                          <button
                            type="button"
                            onClick={() => handlePrintReceipt(order)}
                            disabled={isPrinting}
                            aria-label={`${t('sales.printReceipt')}: ${order.id}`}
                            className={`${ICON_BUTTON} text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                          >
                            <Printer className={`h-4 w-4 ${isPrinting ? 'animate-pulse' : ''}`} aria-hidden />
                          </button>
                        </Tooltip>
                        {order.status?.toLowerCase() !== 'refunded' && (
                          <Tooltip label={t('sales.voidOrderTooltip', { defaultValue: 'Void / Refund Order' })} side="left">
                            <button
                              type="button"
                              onClick={() => setVoidTargetOrder(order)}
                              aria-label={`${t('sales.refund')}: ${order.id}`}
                              className={`${ICON_BUTTON} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50`}
                            >
                              <RotateCcw className="h-4 w-4" aria-hidden />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })
            )}
          </div>
          <div className="hidden min-w-0 lg:block">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[24%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead>
                <tr className="table-head">
                  <th className="px-2 py-3">{t('sales.orderId')}</th>
                  <th className="px-2 py-3">{t('sales.cashier', { defaultValue: 'អ្នកលក់' })}</th>
                  <th className="px-2 py-3">{t('common.source', { defaultValue: 'Source' })}</th>
                  <th className="px-2 py-3">{t('sales.items', { defaultValue: 'Items' })}</th>
                  <th className="px-2 py-3">{t('common.dateTime', { defaultValue: 'Date / Time' })}</th>
                  <th className="px-2 py-3">{t('common.payment', { defaultValue: 'Payment' })}</th>
                  <th className="px-2 py-3">{t('common.total', { defaultValue: 'Total' })}</th>
                  <th className="px-2 py-3">{t('common.status', { defaultValue: 'Status' })}</th>
                  <th className="px-2 py-3 text-center">{t('common.actions', { defaultValue: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody className="table-divider">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-2 py-10 text-center text-sm text-stone-500 dark:text-zinc-400">
                      {isLoading ? t('common.loading') : t('sales.emptyLogs', {
                        defaultValue: 'No completed orders found for this month and search filter.',
                      })}
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((order) => {
                    const sStyle =
                      statusStyles[order.status] ||
                      'bg-stone-50 text-stone-700 ring-1 ring-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700'
                    const isPrinting = printingOrderId === order.id

                    return (
                      <tr key={order.id} className="table-row">
                        <td className="whitespace-nowrap px-2 py-3 font-semibold text-forest-600 dark:text-forest-400">
                          {order.id}
                        </td>
                        <td className="min-w-0 break-words px-2 py-3 text-stone-700 dark:text-stone-200 font-medium">
                          {order.staff_name || '—'}
                        </td>
                        <td className="min-w-0 break-words px-2 py-3 text-stone-600 dark:text-stone-300">
                          {order.source ?? '—'}
                        </td>
                        <td className="px-2 py-3 text-stone-700 dark:text-stone-200">
                          {order.items?.length > 0 ? (
                            <ul className="space-y-1" title={order.summary}>
                              {order.items.slice(0, 3).map((item, index) => (
                                <li key={index} className="flex min-w-0 items-baseline gap-1.5 leading-tight">
                                  <span className="shrink-0 rounded-md bg-forest-500/10 px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-forest-700 dark:text-forest-300">
                                    {item.qty}×
                                  </span>
                                  <span className="min-w-0 truncate">{item.name}</span>
                                </li>
                              ))}
                              {order.items.length > 3 && (
                                <li className="text-2xs font-semibold text-stone-500 dark:text-stone-400">
                                  +{order.items.length - 3} {t('sales.more', { defaultValue: 'more' })}
                                </li>
                              )}
                            </ul>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-3 tabular-nums leading-tight text-stone-600 dark:text-stone-300">
                          <span className="block whitespace-nowrap">{formatOrderDate(order.date)}</span>
                          <span className="block whitespace-nowrap">{formatTime12Hour(order.time)}</span>
                        </td>
                        <td className="px-2 py-3">
                          <PaymentMethodBadge method={order.payment} bank={order.payment_bank} bankOnly />
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 font-semibold tabular-nums text-heading">
                          <OrderTotal order={order} />
                        </td>
                        <td className="px-2 py-3">
                          <StatusBadge className={sStyle}>
                            {statusLabel(order.status, t)}
                          </StatusBadge>
                          {order.status?.toLowerCase() === 'refunded' && order.void_reason && (
                            <span className="block mt-0.5 truncate text-2xs text-red-600 dark:text-red-400 italic max-w-[140px]" title={order.void_reason}>
                              {order.void_reason}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <div className="ml-auto flex w-fit items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
                            <Tooltip label={t('sales.viewItems')} side="left">
                              <button
                                type="button"
                                onClick={() => setDetailsOrder(order)}
                                aria-label={`${t('sales.viewItems')}: ${order.id}`}
                                className={`${ICON_BUTTON} text-slate-600 hover:bg-forest-50 hover:text-forest-700 dark:text-zinc-300 dark:hover:bg-forest-950/50 dark:hover:text-forest-300`}
                              >
                                <Eye className="h-4 w-4" aria-hidden />
                              </button>
                            </Tooltip>
                            <Tooltip label={t('sales.printReceipt')} side="left">
                              <button
                                type="button"
                                onClick={() => handlePrintReceipt(order)}
                                disabled={isPrinting}
                                aria-label={`${t('sales.printReceipt')}: ${order.id}`}
                                className={`${ICON_BUTTON} text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                              >
                                <Printer className={`h-4 w-4 ${isPrinting ? 'animate-pulse' : ''}`} aria-hidden />
                              </button>
                            </Tooltip>
                            {order.status?.toLowerCase() !== 'refunded' && (
                              <Tooltip label={t('sales.voidOrderTooltip', { defaultValue: 'Void / Refund Order' })} side="left">
                                <button
                                  type="button"
                                  onClick={() => setVoidTargetOrder(order)}
                                  aria-label={`${t('sales.refund')}: ${order.id}`}
                                  className={`${ICON_BUTTON} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50`}
                                >
                                  <RotateCcw className="h-4 w-4" aria-hidden />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <PaginationBar
            currentPage={Math.min(page, pageCount - 1)}
            totalPages={pageCount}
            onPageChange={setPage}
            className="border-t border-border/60 px-4 py-3"
          />
        </div>
      </div>

      {receiptTransaction && (
        <ReceiptModal
          transaction={receiptTransaction}
          variant="receipt"
          onClose={() => setReceiptTransaction(null)}
        />
      )}

      <SaleDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />

      {voidTargetOrder && (
        <VoidOrderModal
          isOpen={Boolean(voidTargetOrder)}
          onClose={() => setVoidTargetOrder(null)}
          order={voidTargetOrder}
          onConfirmVoid={handleConfirmVoid}
        />
      )}
    </div>
  )
}
