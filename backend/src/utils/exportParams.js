const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const REPORT_SECTIONS = ['income', 'expenses', 'profit', 'orders', 'monthly', 'spending']

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function parseReportMonth(raw) {
  const value = String(raw ?? '').trim()
  if (value === 'all') {
    return {
      scope: 'all',
      label: 'All time',
      fileKey: 'All-Time',
    }
  }

  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) {
    throw invalid('Invalid month. Use YYYY-MM or all.')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    throw invalid('Invalid month. Use YYYY-MM or all.')
  }

  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  return {
    scope: 'month',
    month,
    year,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    fileKey: `${year}-${String(month).padStart(2, '0')}`,
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3))
const MAX_RANGE_DAYS = 800

function utcDate(key) {
  return new Date(`${key}T00:00:00Z`)
}

function dayKey(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(key, days) {
  const date = utcDate(key)
  date.setUTCDate(date.getUTCDate() + days)
  return dayKey(date)
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function shortDate(key) {
  const [year, month, day] = key.split('-').map(Number)
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`
}

/** A whole calendar month (1st to its last day) gets the month name as its label. */
function rangeLabel(from, to) {
  const [year, month, day] = from.split('-').map(Number)
  if (day === 1 && to === `${from.slice(0, 8)}${String(lastDayOfMonth(year, month)).padStart(2, '0')}`) {
    return `${MONTH_NAMES[month - 1]} ${year}`
  }
  return from === to ? shortDate(from) : `${shortDate(from)} - ${shortDate(to)}`
}

function rangePeriod(from, to) {
  return {
    scope: 'range',
    from,
    to,
    label: rangeLabel(from, to),
    fileKey: from === to ? from : `${from}_to_${to}`,
    startDate: from,
    endDate: addDays(to, 1),
  }
}

/** Inclusive from/to (YYYY-MM-DD), as the Reports page sends them. */
function parseReportRange(rawFrom, rawTo) {
  const from = String(rawFrom ?? '').trim()
  const to = String(rawTo ?? '').trim()
  const pattern = /^\d{4}-\d{2}-\d{2}$/
  if (!pattern.test(from) || !pattern.test(to)) {
    throw invalid('Invalid date range. Use from=YYYY-MM-DD&to=YYYY-MM-DD.')
  }
  const start = utcDate(from)
  const end = utcDate(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || dayKey(start) !== from || dayKey(end) !== to) {
    throw invalid('Invalid date range. Use from=YYYY-MM-DD&to=YYYY-MM-DD.')
  }
  if (end < start) throw invalid('The start date must be on or before the end date.')
  if ((end - start) / 86400000 > MAX_RANGE_DAYS) throw invalid('Choose a range of about two years or less.')
  return rangePeriod(from, to)
}

/** from/to wins over month (older clients send only month). */
function parseReportPeriod(query = {}) {
  if (query.from != null || query.to != null) return parseReportRange(query.from, query.to)
  return parseReportMonth(query.month)
}

/**
 * The period to compare against, matching the Reports page: a range starting on the 1st moves back
 * one month (the 1st–6th of October compares with the 1st–6th of September, a whole month with the
 * whole previous month); any other range compares with the same number of days just before it.
 */
function previousPeriod(period) {
  if (!period?.startDate) return null
  const from = period.startDate
  const to = addDays(period.endDate, -1)
  const [year, month, day] = from.split('-').map(Number)
  if (day === 1) {
    const prevYear = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    const [toYear, toMonth, toDay] = to.split('-').map(Number)
    const wholeMonths = toDay === lastDayOfMonth(toYear, toMonth)
    const span = (toYear - year) * 12 + (toMonth - month)
    const endMonthIndex = prevYear * 12 + (prevMonth - 1) + span
    const endYear = Math.floor(endMonthIndex / 12)
    const endMonth = (endMonthIndex % 12) + 1
    const endDay = wholeMonths ? lastDayOfMonth(endYear, endMonth) : Math.min(toDay, lastDayOfMonth(endYear, endMonth))
    const prevFrom = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
    const prevTo = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`
    return rangePeriod(prevFrom, prevTo)
  }
  const length = Math.round((utcDate(to) - utcDate(from)) / 86400000) + 1
  const prevTo = addDays(from, -1)
  return rangePeriod(addDays(prevTo, -(length - 1)), prevTo)
}

function parseReportSections(raw) {
  const parts = String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const unique = []
  for (const part of parts) {
    if (!REPORT_SECTIONS.includes(part)) {
      throw invalid('Invalid report section.')
    }
    if (!unique.includes(part)) unique.push(part)
  }
  if (!unique.length) {
    throw invalid('Select at least one report section.')
  }
  return REPORT_SECTIONS.filter((section) => unique.includes(section))
}

function salesPdfFilename(period) {
  if (period.scope === 'month') {
    return `Mlu_Sales_${period.year}-${String(period.month).padStart(2, '0')}.pdf`
  }
  return 'Mlu_Sales_All-Time.pdf'
}

function reportFilename(period, extension) {
  const key = period.fileKey || (period.scope === 'month'
    ? `${period.year}-${String(period.month).padStart(2, '0')}`
    : 'All-Time')
  return `Mlu_Report_${key}.${extension}`
}

function pdfSafe(value) {
  const cleaned = String(value ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  return cleaned || '-'
}

function roundMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100) / 100
}

function formatMoney(value) {
  const amount = roundMoney(value)
  const text = `$${Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  return amount < 0 ? `-${text}` : text
}

function formatGeneratedAt(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`
}

function actorLabel(user) {
  const username = String(user?.username || '').replace(/[^\x20-\x7E]/g, '').trim()
  if (username) return username
  if (user?.id) return `user ${user.id}`
  return 'unknown'
}

module.exports = {
  REPORT_SECTIONS,
  parseReportMonth,
  parseReportRange,
  parseReportPeriod,
  previousPeriod,
  parseReportSections,
  salesPdfFilename,
  reportFilename,
  pdfSafe,
  roundMoney,
  formatMoney,
  formatGeneratedAt,
  actorLabel,
}
