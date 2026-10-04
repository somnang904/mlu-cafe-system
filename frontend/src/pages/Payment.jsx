import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, CreditCard, Minus, Receipt, Scissors } from 'lucide-react'
import { usePOS } from '../context/POSContext'
import { useConnection } from '../context/ConnectionContext'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationContext'
import { PAYMENT_QUEUE_STATUS } from '../data/tables'
import { calculateTotals } from '../utils/posHelpers'
import { translateDrinkNotes, translateMenuName, translateMenuSummary } from '../utils/menuNameTranslations'
import { playAlertSound } from '../utils/soundAlert'
import PaymentModule from '../components/pos/PaymentModule'
import ReceiptModal from '../components/pos/ReceiptModal'
import SplitBillModal from '../components/pos/SplitBillModal'
import ShiftModal from '../components/pos/ShiftModal'

function ActiveBillList({ bills, selectedId, onSelect }) {
  const { t, i18n } = useTranslation()

  if (bills.length === 0) return null

  return (
    <div className="space-y-2">
      {bills.map((bill) => {
        const { total } = calculateTotals(bill.items)
        const isSelected = selectedId === bill.id

        return (
          <button
            key={bill.id}
            type="button"
            onClick={() => onSelect(bill.id)}
            className={`min-h-11 w-full rounded-2xl border p-4 text-left transition-colors ${
              isSelected
                ? 'surface-emerald-selected'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-heading truncate font-semibold">{bill.name}</p>
                {bill.orderSummary && (
                  <p className="text-muted mt-1 line-clamp-2 text-xs">
                    {translateMenuSummary(bill.orderSummary, i18n.language, t)}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${PAYMENT_QUEUE_STATUS.badge}`}
              >
                {t(PAYMENT_QUEUE_STATUS.labelKey)}
              </span>
            </div>
            <p className="mt-2 text-lg font-bold tabular-nums text-emerald-900 dark:text-emerald-300">
              ${total.toFixed(2)}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function BillManager({
  bill,
  onDecrementItem,
  onUpdateItemPrice,
  onPaymentComplete,
  onSplitBill,
  serverReachable,
}) {
  const { t, i18n } = useTranslation()
  const { isAdmin } = useAuth()
  // Drafts hold only in-progress edits; anything untouched reads straight from the bill.
  const [priceDrafts, setPriceDrafts] = useState({})
  const [draftBillId, setDraftBillId] = useState(bill.id)
  const { subtotal, total } = calculateTotals(bill.items)

  if (draftBillId !== bill.id) {
    setDraftBillId(bill.id)
    setPriceDrafts({})
  }

  const priceValueFor = (item) =>
    priceDrafts[item.id] ?? (item.unitPrice ?? item.price ?? 0).toFixed(2)

  const handlePriceBlur = (itemId) => {
    const draft = priceDrafts[itemId]
    if (draft == null) return
    onUpdateItemPrice(itemId, draft)
    setPriceDrafts((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl surface-emerald text-emerald-900 dark:text-emerald-300">
              <Receipt className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-heading text-base font-bold leading-tight">{bill.name}</h3>
              <p className="text-muted text-xs">{t('payment.itemizedCheckout')}</p>
            </div>
          </div>

          {bill.items.length > 1 && (
            <button
              type="button"
              onClick={onSplitBill}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <Scissors className="h-3.5 w-3.5" />
              {t('payment.splitBill', { defaultValue: 'Split Bill' })}
            </button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2">
      {/* Left: items */}
      <div className="flex min-h-0 flex-col xl:border-r xl:border-border">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {bill.items.map((item, index) => (
          <div
            key={`${item.id ?? 'line'}-${item.name}-${index}`}
            className="surface-inset flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-heading font-medium">
                {translateMenuName(item.name, i18n.language, t)}
              </p>
              {item.notes && !String(item.name || '').includes(item.notes) ? (
                <p className="text-muted mt-0.5 text-xs">{translateDrinkNotes(item.notes, t)}</p>
              ) : null}
              <p className="text-muted text-xs">
                {t('payment.quantity', { count: item.qty || item.quantity || 1 })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onDecrementItem(item.id)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-red-800 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                aria-label={t('a11y.removeOneItem', {
                  item: translateMenuName(item.name, i18n.language, t),
                })}
              >
                <Minus className="h-4 w-4" />
              </button>

              {!isAdmin ? (
                <span className="text-muted text-xs tabular-nums">
                  ${(item.unitPrice ?? item.price ?? 0).toFixed(2)} / {t('payment.each', { defaultValue: 'each' })}
                </span>
              ) : (
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted font-medium">{t('payment.editPrice')}</span>
                <div className="relative">
                  <span className="text-muted absolute left-2.5 top-1/2 -translate-y-1/2 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceValueFor(item)}
                    onChange={(e) =>
                      setPriceDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    onBlur={() => handlePriceBlur(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handlePriceBlur(item.id)
                    }}
                    className="w-20 rounded-lg border border-slate-200 bg-white py-1 pl-6 pr-2 text-sm tabular-nums text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
              </label>
              )}

              <p className="min-w-[4rem] text-right font-semibold tabular-nums text-forest-600 dark:text-forest-400">
                ${(item.lineTotal || 0).toFixed(2)}
              </p>
            </div>
          </div>
        ))}
      </div>

        <div className="text-heading flex shrink-0 items-center justify-between border-t border-border px-5 py-3 font-bold">
          <span>
            {t('payment.totalDue')}
            <span className="text-muted ml-2 text-xs font-medium">
              {t('payment.items')}: {bill.items.reduce((sum, item) => sum + (item.qty || item.quantity || 1), 0)}
            </span>
          </span>
          <span className="text-lg tabular-nums text-forest-600 dark:text-forest-400">${subtotal.toFixed(2)}</span>
        </div>
      </div>

      {/* Right: take payment */}
      <div className="min-h-0 overflow-y-auto border-t border-border p-4 xl:border-t-0">
        {!serverReachable ? (
          <p className="mb-3 text-sm text-amber-800 dark:text-amber-200" role="status">
            {t('connection.paymentPaused')}
          </p>
        ) : null}
        <PaymentModule
          disabled={bill.items.length === 0 || !serverReachable}
          billTotal={total}
          onConfirm={(method, options) => onPaymentComplete(method, options)}
        />
      </div>
      </div>
    </div>
  )
}

export default function Payment() {
  const { t } = useTranslation()
  const { pushBanner } = useNotifications()
  const { backendReachable } = useConnection()
  const {
    getActiveBills,
    getBillById,
    paymentTargetId,
    clearPaymentTarget,
    decrementBillItem,
    updateBillItemPrice,
    processPayment,
    processSplitPayment,
    loadSalesHistory,
  } = usePOS()

  const activeBills = getActiveBills()
  const [selectedId, setSelectedId] = useState(null)
  const [completedReceipt, setCompletedReceipt] = useState(null)
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [showShiftModal, setShowShiftModal] = useState(false)

  useEffect(() => {
    if (paymentTargetId != null) {
      setSelectedId(paymentTargetId)
      clearPaymentTarget()
      return
    }

    if (selectedId == null && activeBills.length > 0) {
      setSelectedId(activeBills[0].id)
    }
  }, [paymentTargetId, activeBills, selectedId, clearPaymentTarget])

  useEffect(() => {
    if (selectedId == null) return
    const stillActive = activeBills.some((bill) => bill.id === selectedId)
    if (!stillActive) {
      setSelectedId(activeBills[0]?.id ?? null)
    }
  }, [activeBills, selectedId])

  const selectedBill = selectedId != null ? getBillById(selectedId) : null

  const handlePaymentComplete = async (paymentMethod, options = {}) => {
    if (!selectedBill) return
    const sourceLabel = selectedBill.name || selectedBill.source || t('payment.orderSource')
    const clearImmediately = options.clearImmediately ?? true
    const transaction = await processPayment(selectedBill.id, paymentMethod, clearImmediately, options)
    if (!transaction || transaction.error) {
      pushBanner(
        backendReachable
          ? {
              title: t('payment.failedTitle'),
              message: transaction?.error || t('payment.failedMessage'),
              tone: 'error',
            }
          : {
              title: t('connection.serverDown'),
              message: t('connection.paymentPaused'),
              tone: 'warning',
            },
      )
      return
    }
    if (transaction) {
      setCompletedReceipt(transaction)
      pushBanner({
        title: t('payment.receivedTitle'),
        message:
          t('payment.receivedMessage', {
            source: sourceLabel,
            invoice: transaction.id,
          }) + (!clearImmediately ? ` · ${t('payment.tableMarkedPaid')}` : ''),
        tone: 'success',
      })
      loadSalesHistory?.()

      if (transaction.lowStockItems && transaction.lowStockItems.length > 0) {
        const hasCritical = transaction.lowStockItems.some((it) => it.isCritical)
        playAlertSound(hasCritical ? 'critical' : 'warning')
        const itemsList = transaction.lowStockItems
          .map((it) => `${it.itemName} (${it.quantity} ${it.unit})`)
          .join(', ')
        pushBanner({
          title: hasCritical
            ? (t('payment.criticalStockAlertTitle') || 'Critical Stock Alert')
            : (t('payment.lowStockAlertTitle') || 'Low Stock Alert'),
          message: `${t('payment.lowStockAlertDesc') || 'Item running low'}: ${itemsList}`,
          tone: hasCritical ? 'error' : 'warning',
          durationMs: 8000,
        })
      }
    }
  }

  const handlePaySplit = async (splitItems, paymentMethod, options = {}) => {
    if (!selectedBill) return
    try {
      const transaction = await processSplitPayment(
        selectedBill.id,
        splitItems,
        paymentMethod,
        options.clearImmediately ?? false,
        options,
      )
      if (transaction) {
        setShowSplitModal(false)
        setCompletedReceipt(transaction)
        pushBanner({
          title: t('payment.receivedTitle'),
          message: t('payment.splitPaidSuccess', { defaultValue: 'Split payment completed successfully.' }),
          tone: 'success',
        })
        loadSalesHistory?.()
      }
    } catch (err) {
      pushBanner({
        title: t('common.error', { defaultValue: 'Error' }),
        message: err.message,
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex flex-col gap-4 page-enter lg:h-[calc(100vh-5rem)] lg:min-h-0 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h3 className="page-title">{t('nav.payment')}</h3>
        <button
          type="button"
          onClick={() => setShowShiftModal(true)}
          className="inline-flex items-center gap-2 rounded-2xl border border-border bg-white px-3.5 py-2 text-xs font-semibold text-foreground shadow-sm hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {t('shifts.manageShift', { defaultValue: 'Shift & Cash Drawer' })}
        </button>
      </div>

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        <div className="surface-panel flex max-h-[40vh] flex-col overflow-hidden shadow-sm lg:max-h-none lg:w-[min(100%,320px)] lg:shrink-0">
          <div className="border-b border-border px-5 py-4">
            <h4 className="text-heading font-semibold">{t('payment.activeBills')}</h4>
            <p className="text-muted text-xs">
              {t('payment.awaitingPayment', { count: activeBills.length })}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <ActiveBillList
              bills={activeBills}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>

        <div className="surface-panel flex min-h-[min(60vh,32rem)] flex-1 flex-col overflow-hidden shadow-sm lg:min-h-0">
          {selectedBill && selectedBill.items.length > 0 ? (
            <BillManager
              bill={selectedBill}
              onDecrementItem={(itemId) => decrementBillItem(selectedBill.id, itemId)}
              onUpdateItemPrice={(itemId, price) =>
                updateBillItemPrice(selectedBill.id, itemId, price)
              }
              onPaymentComplete={handlePaymentComplete}
              onSplitBill={() => setShowSplitModal(true)}
              serverReachable={backendReachable}
            />
          ) : selectedBill ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <CreditCard className="text-muted mb-4 h-12 w-12 opacity-30" />
              <p className="text-heading font-semibold">{t('payment.emptyBill')}</p>
              <p className="text-muted mt-2 max-w-sm text-sm">
                {t('payment.emptyBillDescription', { name: selectedBill.name })}
              </p>
            </div>
          ) : activeBills.length > 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <CreditCard className="text-muted mb-4 h-12 w-12 opacity-30" />
              <p className="text-heading font-semibold">{t('payment.selectBill')}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <p className="text-heading text-lg font-bold">{t('payment.allSettledTitle')}</p>
              <p className="text-muted mt-1 max-w-sm text-sm">
                {t('payment.allSettledDescription')}
              </p>
            </div>
          )}
        </div>
      </div>

      {completedReceipt && (
        <ReceiptModal
          transaction={completedReceipt}
          variant="receipt"
          onClose={() => {
            setCompletedReceipt(null)
            loadSalesHistory().catch((err) => {
              console.error('Failed to refresh sales history:', err.message)
            })
          }}
        />
      )}

      {showSplitModal && selectedBill && (
        <SplitBillModal
          isOpen={showSplitModal}
          onClose={() => setShowSplitModal(false)}
          bill={selectedBill}
          onPaySplit={handlePaySplit}
        />
      )}

      {showShiftModal && (
        <ShiftModal
          isOpen={showShiftModal}
          onClose={() => setShowShiftModal(false)}
        />
      )}
    </div>
  )
}
