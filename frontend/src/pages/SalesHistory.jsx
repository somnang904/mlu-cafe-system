import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer, RotateCcw, Search } from 'lucide-react'
import ReceiptModal from '../components/pos/ReceiptModal'
import VoidOrderModal from '../components/pos/VoidOrderModal'
import { SalesFilterBar } from '../components/ui/SalesFilterBar'
import { usePOS } from '../context/POSContext'
import { fetchReceiptTransaction } from '../utils/receiptHelpers'
import {
  DEFAULT_HISTORY_DAYS,
  buildDynamicMonthFilterOptions,
  filterCompletedOrders,
  filterOrdersForPeriod,
  formatMonthLabel,
  getCurrentMonthKey,
  summarizeSalesMetrics,
} from '../utils/salesHistoryAnalytics'
import { formatOrderDate, formatTime12Hour, sortOrdersByDateTime } from '../utils/dateTimeFormat'
import PaymentMethodBadge from '../components/common/PaymentMethodBadge'
import StatusBadge from '../components/common/StatusBadge'

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
  const { salesHistory, loadSalesHistory, refundOrder } = usePOS()
  const [search, setSearch] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthKey())
  const [receiptTransaction, setReceiptTransaction] = useState(null)
  const [printingOrderId, setPrintingOrderId] = useState(null)
  const [receiptError, setReceiptError] = useState('')
  const [voidTargetOrder, setVoidTargetOrder] = useState(null)

  const completedHistory = useMemo(
    () => filterCompletedOrders(salesHistory || []),
    [salesHistory],
  )

  const monthOptions = useMemo(
    () =>
      buildDynamicMonthFilterOptions(
        completedHistory,
        [],
        new Date(),
        t,
        t('sales.allMonthsInRange'),
      ),
    [completedHistory, t],
  )

  useEffect(() => {
    async function loadMonthHistory() {
      try {
        if (selectedMonth === 'all') {
          await loadSalesHistory({ days: DEFAULT_HISTORY_DAYS })
        } else {
          await loadSalesHistory({ month: selectedMonth })
        }
      } catch {
        // Silent: the next order event or month change reloads it.
      }
    }

    loadMonthHistory()

    let channel
    try {
      channel = new BroadcastChannel('mlu-pos-sync')
      channel.onmessage = () => {
        loadMonthHistory()
      }
    } catch {
      // BroadcastChannel is missing in some browsers; cross-tab sync is optional.
    }

    window.addEventListener('mlu-order-completed', loadMonthHistory)

    return () => {
      window.removeEventListener('mlu-order-completed', loadMonthHistory)
      if (channel) channel.close()
    }
  }, [selectedMonth, loadSalesHistory])

  const monthScopedHistory = useMemo(
    () => filterOrdersForPeriod(completedHistory, selectedMonth),
    [completedHistory, selectedMonth],
  )

  const monthMetrics = useMemo(
    () => summarizeSalesMetrics(completedHistory, selectedMonth),
    [completedHistory, selectedMonth],
  )

  const filteredLogs = useMemo(() => {
    const searched = monthScopedHistory.filter(
      (order) =>
        (order.id || '').toLowerCase().includes(search.toLowerCase()) ||
        (order.payment || '').toLowerCase().includes(search.toLowerCase()) ||
        (order.status || '').toLowerCase().includes(search.toLowerCase()) ||
        (order.source ?? '').toLowerCase().includes(search.toLowerCase()),
    )
    return sortOrdersByDateTime(searched, 'desc')
  }, [monthScopedHistory, search])

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
    if (selectedMonth === 'all') {
      await loadSalesHistory({ days: DEFAULT_HISTORY_DAYS })
    } else {
      await loadSalesHistory({ month: selectedMonth })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-heading text-lg">{t('nav.salesHistory')}</h3>
      </div>

      {receiptError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {receiptError}
        </div>
      )}

      <div className="space-y-4">
        <div className="surface-card p-4">
          <SalesFilterBar
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            monthOptions={monthOptions}
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div className="surface-inset rounded-xl px-4 py-3">
              <p className="text-muted text-xs uppercase tracking-wider">
                {t('sales.period', { defaultValue: 'Period' })}
              </p>
              <p className="text-heading mt-1 text-sm font-semibold">
                {selectedMonth === 'all'
                  ? t('sales.allMonthsInRange')
                  : formatMonthLabel(selectedMonth, t)}
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
          <div className="border-b border-olive-100/60 p-4 dark:border-olive-800/30">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
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
          </div>
          <div className="lg:hidden">
            {filteredLogs.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-stone-500 dark:text-zinc-400">
                {t('sales.emptyLogs', {
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
                      <PaymentMethodBadge method={order.payment} />
                    </div>
                    <p className="mt-2 min-w-0 break-words text-sm text-stone-600 dark:text-stone-300">
                      {order.source ?? '—'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <p className="tabular-nums leading-tight text-stone-600 dark:text-stone-300">
                        <span className="block">{formatOrderDate(order.date)}</span>
                        <span className="block">{formatTime12Hour(order.time)}</span>
                      </p>
                      <p className="font-semibold tabular-nums text-heading">${(order.total || 0).toFixed(2)}</p>
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
                      <div className="flex items-center gap-1.5">
                        {order.status?.toLowerCase() !== 'refunded' && (
                          <button
                            type="button"
                            onClick={() => setVoidTargetOrder(order)}
                            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300"
                            title={t('sales.voidOrderTooltip', { defaultValue: 'Void / Refund Order' })}
                          >
                            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                            {t('sales.refund', { defaultValue: 'Refund' })}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePrintReceipt(order)}
                          disabled={isPrinting}
                          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/50 bg-card/50 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60 dark:bg-card/30"
                        >
                          <Printer className="h-3.5 w-3.5 shrink-0" />
                          {isPrinting
                            ? t('common.loading', { defaultValue: 'Loading...' })
                            : t('sales.printReceipt', { defaultValue: 'Print Receipt' })}
                        </button>
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
                <col className="w-[12%]" />
                <col />
                <col className="w-[12%]" />
                <col className="w-[15%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
                <col className="w-[25%]" />
              </colgroup>
              <thead>
                <tr className="table-head">
                  <th className="px-2 py-3">{t('sales.orderId')}</th>
                  <th className="px-2 py-3">{t('common.source', { defaultValue: 'Source' })}</th>
                  <th className="px-2 py-3">{t('common.dateTime', { defaultValue: 'Date / Time' })}</th>
                  <th className="px-2 py-3">{t('common.payment', { defaultValue: 'Payment' })}</th>
                  <th className="px-2 py-3">{t('common.total', { defaultValue: 'Total' })}</th>
                  <th className="px-2 py-3">{t('common.status', { defaultValue: 'Status' })}</th>
                  <th className="px-2 py-3 text-right">{t('common.actions', { defaultValue: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody className="table-divider">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-10 text-center text-sm text-stone-500 dark:text-zinc-400">
                      {t('sales.emptyLogs', {
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
                        <td className="min-w-0 break-words px-2 py-3 text-stone-600 dark:text-stone-300">
                          {order.source ?? '—'}
                        </td>
                        <td className="px-2 py-3 tabular-nums leading-tight text-stone-600 dark:text-stone-300">
                          <span className="block whitespace-nowrap">{formatOrderDate(order.date)}</span>
                          <span className="block whitespace-nowrap">{formatTime12Hour(order.time)}</span>
                        </td>
                        <td className="px-2 py-3">
                          <PaymentMethodBadge method={order.payment} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 font-semibold tabular-nums text-heading">
                          ${(order.total || 0).toFixed(2)}
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
                          <div className="flex items-center justify-end gap-1.5">
                            {order.status?.toLowerCase() !== 'refunded' && (
                              <button
                                type="button"
                                onClick={() => setVoidTargetOrder(order)}
                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300"
                                title={t('sales.voidOrderTooltip', { defaultValue: 'Void / Refund Order' })}
                              >
                                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                                {t('sales.refund', { defaultValue: 'Refund' })}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handlePrintReceipt(order)}
                              disabled={isPrinting}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border/50 bg-card/50 px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60 dark:bg-card/30"
                            >
                              <Printer className="h-3.5 w-3.5 shrink-0" />
                              {isPrinting
                                ? t('common.loading', { defaultValue: 'Loading...' })
                                : t('sales.printReceipt', { defaultValue: 'Print Receipt' })}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {receiptTransaction && (
        <ReceiptModal
          transaction={receiptTransaction}
          variant="receipt"
          onClose={() => setReceiptTransaction(null)}
        />
      )}

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
