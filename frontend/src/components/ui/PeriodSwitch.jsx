import { useTranslation } from 'react-i18next'

/** Segmented period picker (Day / Week / Month / …). `options` are { id, label }. */
export default function PeriodSwitch({ value, onChange, options }) {
  const { t } = useTranslation()
  return (
    <div
      role="radiogroup"
      aria-label={t('reports.periodLabel')}
      className="inline-flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-900 dark:ring-zinc-700"
    >
      {options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`h-8 shrink-0 rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-forest-500 ${
            value === id
              ? 'bg-slate-200 text-slate-900 dark:bg-zinc-700 dark:text-zinc-50'
              : 'text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
