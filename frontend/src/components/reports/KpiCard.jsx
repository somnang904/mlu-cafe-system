import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import { formatPercent } from './reportFormat'

/**
 * One KPI. With `change` (a % from percentChange, or null when there is nothing to compare with)
 * it shows the trend: green when it moved the good way, red otherwise. `goodWhen="down"` is for
 * money going out (expenses, refunds), where a rise is bad. `onClick` makes the whole card a link.
 */
export default function KpiCard({ label, value, hint, icon: Icon, accent, change, compare = false, goodWhen = 'up', onClick }) {
  const { t } = useTranslation()
  const Tag = onClick ? 'button' : 'div'

  let trend = null
  if (compare) {
    if (change == null || !Number.isFinite(change)) {
      trend = <span className="text-muted">{t('reports.noComparison')}</span>
    } else {
      const flat = Math.abs(change) < 0.05
      const good = flat ? null : (change > 0) === (goodWhen === 'up')
      const Arrow = flat ? ArrowRight : change > 0 ? ArrowUpRight : ArrowDownRight
      const tone = good == null
        ? 'text-slate-500 dark:text-zinc-400'
        : good ? 'text-forest-600 dark:text-forest-400' : 'text-red-600 dark:text-red-400'
      trend = (
        <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
          <Arrow className="h-3.5 w-3.5" aria-hidden />
          {change > 0 ? '+' : ''}{formatPercent(change)}
          <span className="text-muted ml-1 font-normal">{t('reports.vsPrevious')}</span>
        </span>
      )
    }
  }

  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`surface-card flex w-full flex-col p-4 text-left sm:p-5 ${
        onClick
          ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500 motion-reduce:hover:translate-y-0'
          : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-sm">{label}</p>
          <p className="text-heading mt-1.5 truncate text-2xl font-bold tabular-nums">{value}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${accent}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      {trend || hint ? (
        <div className="mt-2 space-y-0.5 text-xs">
          {trend ? <p>{trend}</p> : null}
          {hint ? <p className="text-muted">{hint}</p> : null}
        </div>
      ) : null}
    </Tag>
  )
}
