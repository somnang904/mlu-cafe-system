// Date ranges for the Reports page. Keys are local YYYY-MM-DD strings; `to` is inclusive.
// previousRange() matches the backend's previousPeriod() (backend/src/utils/exportParams.js),
// so the % on the page and the "Previous" column in an export compare the same days.

export const REPORT_PRESETS = ['thisMonth', 'last7', 'custom']

// Up to ~2 months the charts and exports show one bar/row per day; longer ranges go by month.
export const DAILY_MAX_DAYS = 62

function pad(value) {
  return String(value).padStart(2, '0')
}

export function toDayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseDayKey(key) {
  const [year, month, day] = String(key || '').split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

export function addDays(key, days) {
  const date = parseDayKey(key)
  date.setDate(date.getDate() + days)
  return toDayKey(date)
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

export function isDayKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
  return toDayKey(parseDayKey(value)) === value
}

/**
 * Range for a preset, relative to `today` (a Date): day (today), week (Monday to today),
 * month / thisMonth (1st to today), year (1 January to today), last7 (the last 7 days).
 */
export function presetRange(preset, today = new Date()) {
  const to = toDayKey(today)
  if (preset === 'day') return { from: to, to }
  if (preset === 'week') return { from: addDays(to, -((today.getDay() + 6) % 7)), to }
  if (preset === 'year') return { from: `${to.slice(0, 4)}-01-01`, to }
  if (preset === 'last7') return { from: addDays(to, -6), to }
  return { from: `${to.slice(0, 7)}-01`, to }
}

function sameDayLastYear(key) {
  const shifted = `${Number(key.slice(0, 4)) - 1}${key.slice(4)}`
  // 29 February has no match the year before.
  return shifted.endsWith('-02-29') ? shifted.replace('-02-29', '-02-28') : shifted
}

/**
 * What a preset is compared with: day → yesterday, week → the same days last week,
 * month → the same days last month, year → the same days last year, custom → previousRange().
 */
export function comparisonRange(preset, from, to) {
  if (preset === 'day') return { from: addDays(from, -1), to: addDays(to, -1) }
  if (preset === 'week') return { from: addDays(from, -7), to: addDays(to, -7) }
  if (preset === 'year') return { from: sameDayLastYear(from), to: sameDayLastYear(to) }
  return previousRange(from, to)
}

/** The whole calendar month `monthKey` (YYYY-MM), clipped to today for the current month. */
export function monthRange(monthKey, today = new Date()) {
  const [year, month] = monthKey.split('-').map(Number)
  const from = `${monthKey}-01`
  const end = `${monthKey}-${pad(lastDayOfMonth(year, month))}`
  const todayKey = toDayKey(today)
  return { from, to: end > todayKey && from <= todayKey ? todayKey : end }
}

export function dayCount(from, to) {
  return Math.round((parseDayKey(to) - parseDayKey(from)) / 86400000) + 1
}

export function dayKeysBetween(from, to) {
  const keys = []
  for (let key = from; key <= to; key = addDays(key, 1)) keys.push(key)
  return keys
}

export function monthKeysBetween(from, to) {
  return [...new Set(dayKeysBetween(from, to).map((key) => key.slice(0, 7)))]
}

export function rangeGrain(from, to) {
  return dayCount(from, to) <= DAILY_MAX_DAYS ? 'day' : 'month'
}

/**
 * The period to compare with: a range starting on the 1st moves back one month (Oct 1–6 → Sep 1–6,
 * a whole month → the whole previous month); any other range → the same number of days just before.
 */
export function previousRange(from, to) {
  const [year, month, day] = from.split('-').map(Number)
  if (day === 1) {
    const prevYear = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    const [toYear, toMonth, toDay] = to.split('-').map(Number)
    const wholeMonths = toDay === lastDayOfMonth(toYear, toMonth)
    const span = (toYear - year) * 12 + (toMonth - month)
    const endIndex = prevYear * 12 + (prevMonth - 1) + span
    const endYear = Math.floor(endIndex / 12)
    const endMonth = (endIndex % 12) + 1
    const endDay = wholeMonths ? lastDayOfMonth(endYear, endMonth) : Math.min(toDay, lastDayOfMonth(endYear, endMonth))
    return { from: `${prevYear}-${pad(prevMonth)}-01`, to: `${endYear}-${pad(endMonth)}-${pad(endDay)}` }
  }
  const length = dayCount(from, to)
  const prevTo = addDays(from, -1)
  return { from: addDays(prevTo, -(length - 1)), to: prevTo }
}

export function inRange(dayKey, from, to) {
  return Boolean(dayKey) && dayKey >= from && dayKey <= to
}
