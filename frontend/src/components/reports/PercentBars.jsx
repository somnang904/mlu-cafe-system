import { formatMoney, formatPercent } from './reportFormat'

/** Rows of "label · amount · %" with a bar underneath, largest share first as given. */
export default function PercentBars({ rows, detail }) {
  return (
    <ul className="space-y-3.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-stone-700 dark:text-zinc-200">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-heading font-semibold">{formatMoney(row.amount)}</span>
              <span className="text-muted ml-2">{formatPercent(row.percent)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-700" aria-hidden>
            <div className="h-full rounded-full bg-forest-500" style={{ width: `${Math.min(100, row.percent)}%` }} />
          </div>
          {detail ? <p className="text-muted mt-1 text-xs">{detail(row)}</p> : null}
        </li>
      ))}
    </ul>
  )
}
