import { parseDayKey } from '../../utils/reportRange'

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function formatMoney(value) {
  const amount = Number(value) || 0
  const text = `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return amount < 0 ? `-${text}` : text
}

export function formatPercent(value, digits = 1) {
  return `${(Number(value) || 0).toFixed(digits)}%`
}

function monthName(date, t) {
  return t(`dates.months.${MONTH_KEYS[date.getMonth()]}`)
}

/** "6 October 2026" / "6 តុលា 2026". */
export function formatDayKey(key, t) {
  const date = parseDayKey(key)
  return t('dates.dayMonthYear', { day: date.getDate(), month: monthName(date, t), year: date.getFullYear() })
}

export function formatMonthKey(monthKey, t) {
  const date = parseDayKey(`${monthKey}-01`)
  return t('dates.monthYear', { month: monthName(date, t), year: date.getFullYear() })
}

/** A whole calendar month reads as its name; otherwise "1 October 2026 – 6 October 2026". */
export function formatRangeLabel(from, to, t) {
  const start = parseDayKey(from)
  const end = parseDayKey(to)
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()
  if (start.getDate() === 1 && from.slice(0, 7) === to.slice(0, 7) && end.getDate() === lastDay) {
    return formatMonthKey(from.slice(0, 7), t)
  }
  if (from === to) return formatDayKey(from, t)
  return t('reports.rangeLabel', { from: formatDayKey(from, t), to: formatDayKey(to, t) })
}

/** Chart axis label (short) and tooltip title for a day or month bucket. */
export function chartLabels(key, grain, t) {
  if (grain === 'month') {
    const date = parseDayKey(`${key}-01`)
    return { label: monthName(date, t).slice(0, 3), fullLabel: formatMonthKey(key, t) }
  }
  return { label: String(parseDayKey(key).getDate()), fullLabel: formatDayKey(key, t) }
}
