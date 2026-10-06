import { ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Modal from '../common/Modal'
import { translateDrinkNotes, translateMenuName } from '../../utils/menuNameTranslations'

export default function OrderItemsModal({ title, items = [], onClose }) {
  const { t, i18n } = useTranslation()
  const lines = items.map((item) => {
    const quantity = Number(item.qty ?? item.quantity ?? 1)
    const unitPrice = Number(item.unitPrice ?? item.price ?? 0)
    return {
      key: item.id ?? `${item.menu_item_id}-${item.notes}`,
      name: translateMenuName(item.originalName || item.name, i18n.language, t),
      notes: item.notes ? translateDrinkNotes(item.notes, t) : '',
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    }
  })
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0)
  const count = lines.reduce((sum, line) => sum + line.quantity, 0)

  return (
    <Modal
      titleId="order-items-title"
      onClose={onClose}
      closeLabel={t('common.close')}
      maxWidth="max-w-md"
      header={
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
            <ReceiptText className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 id="order-items-title" className="text-heading truncate text-lg font-semibold">
              {title}
            </h3>
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
              {t('tables.orderItemCount', { count })}
            </p>
          </div>
        </div>
      }
      footer={
        <div className="flex w-full items-baseline justify-between rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200/70 dark:bg-zinc-800/60 dark:ring-zinc-700">
          <span className="text-base font-semibold text-slate-900 dark:text-zinc-100">{t('common.total')}</span>
          <span className="text-2xl font-bold tabular-nums text-forest-600 dark:text-forest-400">
            ${total.toFixed(2)}
          </span>
        </div>
      }
    >
      <ul className="divide-y divide-slate-100 dark:divide-zinc-800">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start gap-3 py-3 first:pt-0">
            <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-forest-50 px-1.5 text-sm font-bold tabular-nums text-forest-700 dark:bg-forest-950/50 dark:text-forest-300">
              {line.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{line.name}</p>
              {line.notes ? <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">{line.notes}</p> : null}
              <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-zinc-400">
                {t('order.each', { price: `$${line.unitPrice.toFixed(2)}` })}
              </p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-zinc-100">
              ${line.lineTotal.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
