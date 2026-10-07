import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Scissors, Minus, Plus } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { translateMenuName, translateDrinkNotes } from '../../utils/menuNameTranslations'
import { formatUsd, formatKhr, usdToKhr } from '../../utils/currency'
import { useExchangeRate } from '../../hooks/useExchangeRate'
import PaymentModule from './PaymentModule'
import ModalHeader from '../ui/ModalHeader'

const NO_ITEMS = []

export default function SplitBillModal({ isOpen, onClose, bill, onPaySplit }) {
  const exchangeRate = useExchangeRate()
  const { t, i18n } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })

  // splitQuantities: { [item.id]: selectedQtyToSplit }
  const [splitQuantities, setSplitQuantities] = useState({})
  const [showCheckout, setShowCheckout] = useState(false)

  // Shared fallback: a fresh [] each render would invalidate the useMemo below every time.
  const items = bill?.items ?? NO_ITEMS

  const handleQtyChange = (itemId, maxQty, delta) => {
    setSplitQuantities((prev) => {
      const current = prev[itemId] || 0
      const next = Math.max(0, Math.min(maxQty, current + delta))
      if (next === 0) {
        const copy = { ...prev }
        delete copy[itemId]
        return copy
      }
      return { ...prev, [itemId]: next }
    })
  }

  const handleSelectAll = () => {
    const next = {}
    for (const item of items) {
      next[item.id] = item.qty
    }
    setSplitQuantities(next)
  }

  const handleClearAll = () => {
    setSplitQuantities({})
  }

  const { splitItems, splitTotal, remainingTotal } = useMemo(() => {
    let sTotal = 0
    let rTotal = 0
    const sItems = []

    for (const item of items) {
      const sQty = splitQuantities[item.id] || 0
      const rQty = item.qty - sQty
      const price = Number(item.unitPrice || item.price || 0)

      if (sQty > 0) {
        sItems.push({
          ...item,
          qty: sQty,
          quantity: sQty,
          unitPrice: price,
          price,
          lineTotal: sQty * price,
        })
        sTotal += sQty * price
      }
      if (rQty > 0) {
        rTotal += rQty * price
      }
    }

    return {
      splitItems: sItems,
      splitTotal: Math.round(sTotal * 100) / 100,
      remainingTotal: Math.round(rTotal * 100) / 100,
    }
  }, [items, splitQuantities])

  if (!isOpen || !bill) return null

  const handleCheckoutConfirm = (method, options) => {
    onPaySplit?.(splitItems, method, options)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="modal-panel relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="border-b border-border p-5">
          <ModalHeader
            icon={Scissors}
            title={t('payment.splitBill', { defaultValue: 'Split Bill' })}
            subtitle={`${bill.name} · ${t('payment.splitSubtitle', { defaultValue: 'Select items to pay separately' })}`}
            onClose={onClose}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!showCheckout ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  {t('payment.items')}
                </span>
                <div className="flex gap-2 text-xs font-medium">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    {t('common.selectAll', { defaultValue: 'Select All' })}
                  </button>
                  <span className="text-slate-300 dark:text-zinc-700">|</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-slate-500 hover:underline dark:text-zinc-400"
                  >
                    {t('common.clear', { defaultValue: 'Clear' })}
                  </button>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2.5">
                {items.map((item) => {
                  const sQty = splitQuantities[item.id] || 0
                  const isSelected = sQty > 0
                  const price = Number(item.unitPrice || item.price || 0)

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition ${
                        isSelected
                          ? 'border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/20'
                          : 'border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-heading text-sm font-semibold truncate">
                          {translateMenuName(item.name, i18n.language, t)}
                        </p>
                        {item.notes ? (
                          <p className="text-muted text-xs truncate">
                            {translateDrinkNotes(item.notes, t)}
                          </p>
                        ) : null}
                        <p className="text-muted text-xs tabular-nums mt-0.5">
                          {formatUsd(price)} each · Total: {item.qty} in bill
                        </p>
                      </div>

                      {/* Quantity Controls */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={sQty <= 0}
                          onClick={() => handleQtyChange(item.id, item.qty, -1)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-6 text-center text-sm font-bold tabular-nums">
                          {sQty}
                        </span>
                        <button
                          type="button"
                          disabled={sQty >= item.qty}
                          onClick={() => handleQtyChange(item.id, item.qty, 1)}
                          className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    {t('payment.splitToPay', { defaultValue: 'Split to Pay' })}
                  </span>
                  <p className="mt-1 text-lg font-bold tabular-nums text-emerald-950 dark:text-emerald-200">
                    {formatUsd(splitTotal)}
                  </p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {formatKhr(usdToKhr(splitTotal, exchangeRate))}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                    {t('payment.remainingOnTable', { defaultValue: 'Remains on Table' })}
                  </span>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                    {formatUsd(remainingTotal)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                    {formatKhr(usdToKhr(remainingTotal, exchangeRate))}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setShowCheckout(false)}
                className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                ← {t('payment.backToItemSelection', { defaultValue: 'Back to item selection' })}
              </button>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <p className="font-semibold text-slate-900 dark:text-zinc-200 mb-1">
                  {t('payment.splitPayingItems', { defaultValue: 'Paying for:' })}
                </p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {splitItems.map((it) => (
                    <li key={it.id}>
                      {it.qty}× {it.name} (${(it.qty * it.unitPrice).toFixed(2)})
                    </li>
                  ))}
                </ul>
              </div>

              <PaymentModule
                billTotal={splitTotal}
                disabled={splitTotal <= 0}
                onConfirm={handleCheckoutConfirm}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        {!showCheckout && (
          <div className="border-t border-border bg-slate-50 p-4 dark:bg-zinc-900">
            <button
              type="button"
              disabled={splitTotal <= 0}
              onClick={() => setShowCheckout(true)}
              className={`btn-primary w-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                splitTotal <= 0 ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'
              }`}
            >
              {t('payment.proceedToPaySplit', { defaultValue: 'Proceed to Pay Split' })} ({formatUsd(splitTotal)})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
