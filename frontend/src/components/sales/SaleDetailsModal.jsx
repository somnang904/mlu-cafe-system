import { createPortal } from 'react-dom'
import { ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ModalHeader from '../ui/ModalHeader'
import PaymentMethodBadge from '../common/PaymentMethodBadge'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { formatOrderDate, formatTime12Hour } from '../../utils/dateTimeFormat'
import { formatKhr, usdToKhr } from '../../utils/currency'
import { cashPaidIn } from '../../utils/salesHistoryAnalytics'

function money(value) {
  return `$${(Number(value) || 0).toFixed(2)}`
}

export default function SaleDetailsModal({ order, onClose }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: Boolean(order), onEscape: onClose })

  if (!order) return null

  const items = Array.isArray(order.items) ? order.items : []
  const itemCount = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  const isRefunded = String(order.status || '').toLowerCase() === 'refunded'
  const paidIn = cashPaidIn(order)
  const received = [
    Number(order.received_usd) > 0 ? money(order.received_usd) : null,
    Number(order.received_khr) > 0 ? formatKhr(order.received_khr) : null,
  ].filter(Boolean).join(' + ')

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-details-title"
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-white p-6 shadow-2xl outline-none dark:bg-[#151915]"
      >
        <ModalHeader
          icon={ReceiptText}
          title={`${order.id} · ${order.source ?? '—'}`}
          subtitle={`${formatOrderDate(order.date)} ${formatTime12Hour(order.time)}`}
          onClose={onClose}
          titleId="sale-details-title"
        />

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <PaymentMethodBadge method={order.payment} bank={order.payment_bank} bankOnly />
          <span className="text-muted">{t('sales.itemCount', { count: itemCount })}</span>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
          {items.length === 0 ? (
            <p className="text-muted px-4 py-6 text-center text-sm">{t('sales.noItems')}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground dark:bg-zinc-900/60">
                <tr>
                  <th className="px-3 py-2 font-semibold">{t('sales.item')}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t('sales.qty')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('sales.price')}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item, index) => (
                  <tr key={`${item.menu_item_id ?? 'custom'}-${index}`}>
                    <td className="px-3 py-2.5 font-medium">{item.name}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{item.qty}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(item.unitPrice)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 space-y-1 text-sm">
          {Number(order.tax) > 0 ? (
            <>
              <div className="text-muted flex justify-between">
                <span>{t('sales.subtotal')}</span>
                <span className="tabular-nums">{money(order.subtotal)}</span>
              </div>
              <div className="text-muted flex justify-between">
                <span>{t('sales.tax')}</span>
                <span className="tabular-nums">{money(order.tax)}</span>
              </div>
            </>
          ) : null}
          <div className="text-heading flex justify-between text-base font-bold">
            <span>{t('common.total')}</span>
            <span className="tabular-nums">
              {paidIn === 'khr' ? `${formatKhr(usdToKhr(order.total, order.exchange_rate || undefined))} (${money(order.total)})` : money(order.total)}
            </span>
          </div>
          {order.payment === 'Cash' && received ? (
            <>
              <div className="text-muted flex justify-between">
                <span>{t('sales.received')}</span>
                <span className="tabular-nums">{received}</span>
              </div>
              <div className="text-muted flex justify-between">
                <span>{t('sales.change')}</span>
                <span className="tabular-nums">{Number(order.change_usd) > 0 ? `${money(order.change_usd)} (${formatKhr(order.change_khr)})` : money(0)}</span>
              </div>
            </>
          ) : null}
          {isRefunded ? (
            <p className="pt-1 text-xs text-red-600 dark:text-red-400">
              {t('statuses.refunded')}
              {order.refundDate ? ` · ${order.refundDate}` : ''}
              {order.void_reason ? ` · ${order.void_reason}` : ''}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
