import { useTranslation } from 'react-i18next'
import { BadgeCheck, Printer, X } from 'lucide-react'
import { STORE } from '../../config/store'
import { formatDateTimeDisplay } from '../../utils/dateTimeFormat'
import { calculateTotals } from '../../utils/posHelpers'
import { translateDrinkNotes, translateMenuName } from '../../utils/menuNameTranslations'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import BrandLogo from '../common/BrandLogo'

function paymentMethodLabel(method, t) {
  if (method === 'Bank Scan') return t('payment.methods.bankScan')
  if (method === 'Cash') return t('payment.methods.cash')
  return method
}

function ModalShell({ onClose, printLabel, documentContent }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({
    isOpen: true,
    onEscape: onClose,
    primaryActionMode: 'never',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:relative print:inset-auto print:block print:bg-transparent print:p-0">
      <button
        type="button"
        aria-label={t('a11y.close')}
        className="modal-backdrop print:hidden"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[94vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white text-stone-900 shadow-2xl outline-none print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex min-h-9 min-w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 print:hidden"
          aria-label={t('a11y.close')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 pb-4 pt-5 text-stone-900 print:overflow-visible">
          {documentContent}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50 p-3 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            {t('common.done')}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-[#10b981] py-2.5 text-sm font-semibold text-white transition hover:bg-[#0d9668]"
          >
            <Printer className="h-4 w-4" />
            {printLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatKhrAmount(value) {
  return `${Math.round(Number(value)).toLocaleString()} ៛`
}

function ReceiptTemplate({ transaction }) {
  const { t, i18n } = useTranslation()
  const paymentMethod = paymentMethodLabel(transaction.payment || 'Cash', t)
  const rate = transaction.exchange_rate || 4100
  const totalKhr = Math.round((transaction.total * rate) / 100) * 100
  const hasReceived = transaction.received_usd > 0 || transaction.received_khr > 0
  const hasChange = transaction.change_usd > 0 || transaction.change_khr > 0

  return (
    <div
      id="receipt-print-area"
      className="relative mx-auto cursor-default select-none bg-white text-stone-900 print:border print:border-stone-400 print:p-4"
    >
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <BrandLogo className="brand-logo mx-auto h-auto max-h-14 w-auto max-w-[110px] object-contain print:max-h-24 print:max-w-[160px]" />
        <h2 className="mt-2 text-base font-bold tracking-tight text-stone-900">{STORE.officialName}</h2>
        <p className="text-[11px] text-stone-500">{STORE.phone}</p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 ring-1 ring-emerald-300">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            {t('payment.receiptTitle')}
          </span>
        </div>
      </div>

      {/* Receipt details */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-center print:grid-cols-1 print:bg-transparent print:text-left">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-stone-400">{t('payment.receiptNo')}</p>
          <p className="truncate text-xs font-semibold tabular-nums">{transaction.id}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-stone-400">{t('common.dateTime')}</p>
          <p className="text-xs font-medium tabular-nums">{formatDateTimeDisplay(transaction.date, transaction.time)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-stone-400">{t('tables.table')}</p>
          <p className="truncate text-xs font-semibold">{transaction.source}</p>
        </div>
      </div>

      {/* Items */}
      <div className="mt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
          {t('payment.items')}
        </p>
        <div className="max-h-40 space-y-2 overflow-y-auto pr-1 print:max-h-none print:overflow-visible">
          {transaction.items.map((item, index) => (
            <div key={`${item.id ?? 'line'}-${item.name}-${index}`} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug text-stone-900">
                  <span className="mr-1.5 tabular-nums text-stone-500">{item.qty}×</span>
                  {translateMenuName(item.name, i18n.language, t)}
                </p>
                {item.notes && !String(item.name || '').includes(item.notes) ? (
                  <p className="text-xs text-stone-500">{translateDrinkNotes(item.notes, t)}</p>
                ) : null}
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-stone-900">
                ${item.lineTotal.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Total */}
      <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200 print:bg-transparent">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-emerald-900">{t('payment.totalPaid')}</span>
          <span className="text-xl font-bold tabular-nums text-stone-900">${transaction.total.toFixed(2)}</span>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-emerald-700/80">1 USD = {rate.toLocaleString()} ៛</span>
          <span className="font-semibold tabular-nums text-emerald-800">{formatKhrAmount(totalKhr)}</span>
        </div>
      </div>

      {/* Payment info */}
      <div className="mt-3 space-y-1 text-xs text-stone-600">
        <div className="flex justify-between">
          <span>{t('payment.paidVia')}</span>
          <span className="font-semibold text-stone-900">{paymentMethod}</span>
        </div>
        {hasReceived && (
          <div className="flex justify-between">
            <span>{t('payment.received', { defaultValue: 'Cash Received' })}</span>
            <span className="font-medium tabular-nums">
              {[
                transaction.received_usd > 0 ? `$${Number(transaction.received_usd).toFixed(2)}` : null,
                transaction.received_khr > 0 ? formatKhrAmount(transaction.received_khr) : null,
              ]
                .filter(Boolean)
                .join(' + ')}
            </span>
          </div>
        )}
        {hasChange && (
          <div className="flex justify-between font-semibold text-emerald-800">
            <span>{t('payment.changeDue', { defaultValue: 'Change' })}</span>
            <span className="tabular-nums">
              {transaction.change_usd > 0 ? `$${Number(transaction.change_usd).toFixed(2)}` : ''}
              {transaction.change_khr > 0 ? ` (${formatKhrAmount(transaction.change_khr)})` : ''}
            </span>
          </div>
        )}
      </div>

      <p className="receipt-thanks border-t border-dashed border-emerald-200 pt-3">{t(STORE.receiptThanksKey)}</p>
    </div>
  )
}

export default function ReceiptModal({ transaction, onClose }) {
  const { t } = useTranslation()
  if (!transaction) return null

  const items = Array.isArray(transaction.items) ? transaction.items : []
  const hasTotals =
    typeof transaction.subtotal === 'number' && typeof transaction.total === 'number'
  const totals = hasTotals
    ? { subtotal: transaction.subtotal, tax: 0, total: transaction.total }
    : calculateTotals(items)
  const normalizedTransaction = {
    ...transaction,
    items,
    subtotal: totals.subtotal,
    tax: 0,
    total: totals.total,
  }

  return (
    <ModalShell
      onClose={onClose}
      printLabel={t('sales.printReceipt')}
      documentContent={<ReceiptTemplate transaction={normalizedTransaction} />}
    />
  )
}
