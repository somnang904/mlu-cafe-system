import { useTranslation } from 'react-i18next'

const LEVEL_CLASS = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  low: 'bg-amber-50 text-amber-800 ring-amber-600/30 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/30',
  out: 'bg-red-50 text-red-700 ring-red-600/30 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/30',
}

export default function StockBadge({ level, left }) {
  const { t } = useTranslation()
  if (!level) return null

  const label = level === 'out' ? t('order.outOfStock') : t('order.stockLeft', { count: left > 99 ? '99+' : left })

  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums ring-1 ${LEVEL_CLASS[level]}`}
    >
      {label}
    </span>
  )
}
