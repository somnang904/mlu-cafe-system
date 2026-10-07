import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, FileSpreadsheet, FileText } from 'lucide-react'
import SettingToggle from '../ui/SettingToggle'
import PeriodSwitch from '../ui/PeriodSwitch'
import { addDays, toDayKey } from '../../utils/reportRange'
import { formatMonthKey } from './reportFormat'

export const REPORT_PRESETS = ['all', 'day', 'week', 'month', 'year', 'custom']
// The compare switch names what the period is compared with.
const COMPARE_LABELS = {
  day: 'reports.compareTo.day',
  week: 'reports.compareTo.week',
  month: 'reports.compareTo.month',
  year: 'reports.compareTo.year',
  custom: 'reports.compareTo.custom',
}
const MONTH_CHOICES = 24
// Matches the backend limit on from/to (about two years).
const MAX_RANGE_DAYS = 800

function recentMonths(today) {
  return Array.from({ length: MONTH_CHOICES }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

/**
 * Filter and export bar shared by every Reports tab: Day / Week / Month / Year / Custom (custom shows
 * start/end dates and a month shortcut), the compare switch, and Excel / PDF export of exactly that selection.
 */
export default function ReportFilterBar({
  preset,
  onPresetChange,
  range,
  onCustomRangeChange,
  onMonthPick,
  compare,
  onCompareChange,
  rangeLabel,
  rangeError,
  onExport,
}) {
  const { t } = useTranslation()
  const fromId = useId()
  const toId = useId()
  const monthId = useId()
  const today = new Date()
  const todayKey = toDayKey(today)
  const selectedMonth = range.from.slice(0, 7) === range.to.slice(0, 7) && range.from.endsWith('-01')
    ? range.from.slice(0, 7)
    : ''

  return (
    <div className="surface-card space-y-3 p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSwitch
            value={preset}
            onChange={onPresetChange}
            options={REPORT_PRESETS.map((id) => ({ id, label: t(`reports.presets.${id}`) }))}
          />
          <span className="text-muted inline-flex items-center gap-1.5 px-1 text-sm">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
            {rangeLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* All time has nothing before it to compare with. */}
          {COMPARE_LABELS[preset] ? (
            <div className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-zinc-300">
              {/* The text is clickable too; the switch carries the accessible name. */}
              <span className="cursor-pointer select-none" onClick={() => onCompareChange(!compare)} aria-hidden>
                {t(COMPARE_LABELS[preset])}
              </span>
              <SettingToggle enabled={compare} onChange={onCompareChange} ariaLabel={t(COMPARE_LABELS[preset])} />
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onExport('excel')}
              disabled={Boolean(rangeError)}
              className="btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {t('reports.excel')}
            </button>
            <button
              type="button"
              onClick={() => onExport('pdf')}
              disabled={Boolean(rangeError)}
              className="btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText className="h-4 w-4" aria-hidden />
              {t('reports.pdf')}
            </button>
          </div>
        </div>
      </div>

      {preset === 'custom' ? (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label htmlFor={fromId} className="mb-1 block text-xs font-medium text-stone-600 dark:text-zinc-400">
              {t('reports.startDate')}
            </label>
            <input
              id={fromId}
              type="date"
              value={range.from}
              max={range.to || todayKey}
              min={addDays(range.to || todayKey, -MAX_RANGE_DAYS)}
              onChange={(event) => onCustomRangeChange({ from: event.target.value, to: range.to })}
              className="input-field rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={toId} className="mb-1 block text-xs font-medium text-stone-600 dark:text-zinc-400">
              {t('reports.endDate')}
            </label>
            <input
              id={toId}
              type="date"
              value={range.to}
              min={range.from}
              max={todayKey}
              onChange={(event) => onCustomRangeChange({ from: range.from, to: event.target.value })}
              className="input-field rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={monthId} className="mb-1 block text-xs font-medium text-stone-600 dark:text-zinc-400">
              {t('reports.pickMonth')}
            </label>
            <select
              id={monthId}
              value={selectedMonth}
              onChange={(event) => event.target.value && onMonthPick(event.target.value)}
              className="input-field rounded-xl px-3 py-2 text-sm"
            >
              <option value="">{t('reports.chooseMonth')}</option>
              {recentMonths(today).map((monthKey) => (
                <option key={monthKey} value={monthKey}>
                  {formatMonthKey(monthKey, t)}
                </option>
              ))}
            </select>
          </div>
          {rangeError ? (
            <p role="alert" className="text-sm text-red-600 sm:pb-2 dark:text-red-400">{rangeError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
