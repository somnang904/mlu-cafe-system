import { useEffect, useRef, useState } from 'react'
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

function ModalShell({ onClose, printLabel, documentContent, canPrint }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({
    isOpen: true,
    onEscape: onClose,
    primaryActionMode: 'never',
  })

  const handlePrint = () => {
    if (!canPrint) return
    window.print()
  }

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
        className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white text-stone-900 shadow-2xl outline-none print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex min-h-9 min-w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 print:hidden"
          aria-label={t('a11y.close')}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white p-6 text-stone-900 print:overflow-visible">
          {documentContent}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-slate-100 bg-slate-50 p-4 print:hidden">
          <button
            type="button"
            onClick={handlePrint}
            disabled={!canPrint}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#10b981] py-3 font-semibold text-white transition hover:bg-[#0d9668] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            {printLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl py-2.5 font-medium text-slate-600 transition hover:bg-slate-200/50"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReceiptLocationQr({ onSettled }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const imageRef = useRef(null)
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  useEffect(() => {
    const image = imageRef.current
    if (!image) return undefined
    let settled = false
    const finish = (loaded) => {
      if (settled) return
      settled = true
      if (!loaded) setFailed(true)
      onSettledRef.current?.()
    }
    if (image.complete) {
      finish(image.naturalWidth > 0)
      return undefined
    }
    const onLoad = () => finish(true)
    const onError = () => finish(false)
    image.addEventListener('load', onLoad)
    image.addEventListener('error', onError)
    return () => {
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
    }
  }, [])

  if (failed) return null

  return (
    <div className="receipt-location-qr">
      <div className="receipt-location-qr-frame">
        <img
          ref={imageRef}
          data-receipt-qr=""
          src={STORE.locationQr.src}
          alt=""
          draggable={false}
        />
      </div>
      <p className="receipt-location-qr-caption">{t(STORE.locationQr.captionKey)}</p>
    </div>
  )
}

function ReceiptTemplate({ transaction, onQrSettled }) {
  const { t, i18n } = useTranslation()
  const paymentMethod = paymentMethodLabel(transaction.payment || 'Cash', t)

  return (
    <div
      id="receipt-print-area"
      className="relative mx-auto cursor-default select-none overflow-hidden rounded-xl bg-white p-1 text-stone-900 print:rounded-none print:border print:border-stone-400 print:p-4 print:shadow-none"
    >
      <div className="flex flex-col items-center border-b border-dashed border-emerald-200 pb-5 text-center">
        <BrandLogo className="brand-logo mx-auto h-auto max-h-20 w-auto max-w-[140px] object-contain print:max-h-24 print:max-w-[160px]" />
        <h2 className="mt-3 text-xl font-bold tracking-tight text-stone-900">{STORE.officialName}</h2>
        <p className="mt-2 text-[11px] text-stone-500">{STORE.phone}</p>

        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400 bg-emerald-50 px-4 py-1.5">
          <BadgeCheck className="h-4 w-4 text-emerald-600" />
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            {t('payment.receiptTitle')}
          </span>
        </div>
      </div>

      <div className="space-y-1 border-b border-dashed border-emerald-200 py-4 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-stone-500">{t('payment.receiptNo')}</span>
          <span className="font-semibold tabular-nums">{transaction.id}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-stone-500">{t('common.dateTime')}</span>
          <span className="tabular-nums">{formatDateTimeDisplay(transaction.date, transaction.time)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-stone-500">{t('tables.table')}</span>
          <span className="font-medium">{transaction.source}</span>
        </div>
      </div>

      <div className="py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">
          {t('payment.items')}
        </p>
        <div className="space-y-2.5">
          {transaction.items.map((item, index) => (
            <div key={`${item.id ?? 'line'}-${item.name}-${index}`} className="flex justify-between gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-stone-900">
                  {translateMenuName(item.name, i18n.language, t)}
                </p>
                {item.notes && !String(item.name || '').includes(item.notes) ? (
                  <p className="text-xs text-stone-500">{translateDrinkNotes(item.notes, t)}</p>
                ) : null}
                <p className="text-xs text-stone-500">
                  {item.qty} × ${item.unitPrice.toFixed(2)}
                </p>
              </div>
              <p className="shrink-0 font-semibold tabular-nums text-stone-900">
                ${item.lineTotal.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-dashed border-emerald-200 pt-4 text-sm">
        <div className="flex justify-between text-stone-600">
          <span>{t('common.subtotal')}</span>
          <span className="tabular-nums">${transaction.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-emerald-100 pt-2 text-base font-bold text-stone-900">
          <span>{t('payment.totalPaid')} (USD)</span>
          <span className="tabular-nums">${transaction.total.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold text-emerald-800">
          <span>{t('payment.totalPaid')} (KHR)</span>
          <span className="tabular-nums">{((Math.round(transaction.total * (transaction.exchange_rate || 4100) / 100) * 100)).toLocaleString()} ៛</span>
        </div>
        <div className="text-right text-[10px] text-stone-400">
          1 USD = {(transaction.exchange_rate || 4100).toLocaleString()} KHR
        </div>

        {/* Cash Received & Change Breakdown if recorded */}
        {(transaction.received_usd > 0 || transaction.received_khr > 0 || transaction.change_usd > 0 || transaction.change_khr > 0) && (
          <div className="mt-2 space-y-1 border-t border-dashed border-stone-200 pt-2 text-xs text-stone-600">
            {(transaction.received_usd > 0 || transaction.received_khr > 0) && (
              <div className="flex justify-between">
                <span>{t('payment.received', { defaultValue: 'Cash Received' })}</span>
                <span className="tabular-nums font-medium">
                  {transaction.received_usd > 0 ? `$${Number(transaction.received_usd).toFixed(2)} ` : ''}
                  {transaction.received_khr > 0 ? `${Number(transaction.received_khr).toLocaleString()} ៛` : ''}
                </span>
              </div>
            )}
            {(transaction.change_usd > 0 || transaction.change_khr > 0) && (
              <div className="flex justify-between text-emerald-800 font-semibold">
                <span>{t('payment.changeDue', { defaultValue: 'Change' })}</span>
                <span className="tabular-nums">
                  {transaction.change_usd > 0 ? `$${Number(transaction.change_usd).toFixed(2)} ` : ''}
                  {transaction.change_khr > 0 ? `(${Number(transaction.change_khr).toLocaleString()} ៛)` : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-dashed border-emerald-400 bg-emerald-50 px-4 py-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          {t('payment.paidVia')}
        </p>
        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-emerald-900">
          {paymentMethod}
        </p>
      </div>

      <p className="receipt-thanks">{t(STORE.receiptThanksKey)}</p>
      <ReceiptLocationQr onSettled={onQrSettled} />
    </div>
  )
}

export default function ReceiptModal({ transaction, onClose }) {
  const { t } = useTranslation()
  const [canPrint, setCanPrint] = useState(false)
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
      canPrint={canPrint}
      documentContent={
        <ReceiptTemplate
          transaction={normalizedTransaction}
          onQrSettled={() => setCanPrint(true)}
        />
      }
    />
  )
}
