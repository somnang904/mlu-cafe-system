import { useTranslation } from 'react-i18next'
import { Banknote, Landmark, UserRound, Wallet } from 'lucide-react'

const SOURCES = [
  { id: 'drawer', icon: Banknote },
  { id: 'bank', icon: Landmark },
  { id: 'owner', icon: UserRound },
]

const BADGE_TONES = {
  drawer:
    'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300',
  bank: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:border-sky-500/30 dark:bg-sky-950/40 dark:text-sky-300',
  owner:
    'border-violet-500/25 bg-violet-500/10 text-violet-800 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300',
}

function sourceFor(value) {
  return SOURCES.find((source) => source.id === value) || SOURCES[0]
}

/** `options` limits the choices (a cash expense comes from the drawer or the owner, never the bank). */
export function PaidFromSelector({ value, onChange, idPrefix = 'expense', options = null }) {
  const { t } = useTranslation()
  const sources = options ? SOURCES.filter((source) => options.includes(source.id)) : SOURCES
  const selected = sources.find((source) => source.id === value) || sources[0]
  const labelId = `${idPrefix}-paid-from-label`
  const hintId = `${idPrefix}-paid-from-hint`

  return (
    <div>
      <p id={labelId} className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
        <Wallet className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
        {t('expenses.paidFrom')}
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className={`grid gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-zinc-800 ${sources.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
      >
        {sources.map((source) => {
          const Icon = source.icon
          const active = source.id === selected.id
          return (
            <button
              key={source.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(source.id)}
              className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition ${
                active
                  ? 'bg-white text-forest-700 shadow-sm dark:bg-zinc-700 dark:text-forest-300'
                  : 'text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t(`expenses.paidFromOptions.${source.id}`)}</span>
            </button>
          )
        })}
      </div>
      <p id={hintId} className="text-muted mt-1.5 text-xs">
        {t(`expenses.paidFromHints.${selected.id}`)}
      </p>
    </div>
  )
}

export function PaidFromBadge({ value }) {
  const { t } = useTranslation()
  const source = sourceFor(value)
  const Icon = source.icon
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs font-medium ${BADGE_TONES[source.id]}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(`expenses.paidFromOptions.${source.id}`)}
    </span>
  )
}
