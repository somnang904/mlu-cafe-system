import i18n from '../i18n'

const KHMER_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩']

export function localizeDigits(value) {
  const text = String(value ?? '')
  if (!String(i18n.language || '').startsWith('km')) return text
  return text.replace(/d/g, (digit) => KHMER_DIGITS[Number(digit)])
}

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_24H_REGEX = /^(\d{1,2}):(\d{2})$/
const TIME_12H_REGEX = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i

export function formatOrderDate(input) {
  if (!input) return '—'

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '—'
    const year = input.getFullYear()
    const month = String(input.getMonth() + 1).padStart(2, '0')
    const day = String(input.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const raw = String(input).trim()
  if (DATE_ISO_REGEX.test(raw)) return raw

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return formatOrderDate(parsed)
}

export function formatTime12Hour(input) {
  if (!input) return '—'

  const options = { hour: 'numeric', minute: '2-digit', hour12: true }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return '—'
    return input.toLocaleTimeString('en-US', options)
  }

  const raw = String(input).trim()
  const twelveHourMatch = raw.match(TIME_12H_REGEX)
  if (twelveHourMatch) {
    let hour = Number.parseInt(twelveHourMatch[1], 10)
    const minute = Number.parseInt(twelveHourMatch[2], 10)
    const period = twelveHourMatch[3].toUpperCase()
    if (period === 'PM' && hour < 12) hour += 12
    if (period === 'AM' && hour === 12) hour = 0
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-US', options)
  }

  const twentyFourHourMatch = raw.match(TIME_24H_REGEX)
  if (twentyFourHourMatch) {
    const hour24 = Number.parseInt(twentyFourHourMatch[1], 10)
    const minute = Number.parseInt(twentyFourHourMatch[2], 10)
    const date = new Date(2000, 0, 1, hour24, minute)
    return date.toLocaleTimeString('en-US', options)
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return formatTime12Hour(parsed)
  }

  return raw
}

export function formatTimeRange12Hour(startInput, endInput) {
  const start = formatTime12Hour(startInput)
  const end = formatTime12Hour(endInput)
  if (start === '—' && end === '—') return '—'
  if (end === '—') return start
  if (start === '—') return end
  return `${start} - ${end}`
}

export function formatSlotRange12Hour(timeSlot, durationMinutes = 120, fallbackLabel) {
  const startRaw = String(timeSlot || '').trim()
  const startMatch = startRaw.match(TIME_24H_REGEX) || startRaw.match(/^(\d{1,2}):(\d{2})/)
  if (startMatch) {
    const hour = Number.parseInt(startMatch[1], 10)
    const minute = Number.parseInt(startMatch[2], 10)
    const start = new Date(2000, 0, 1, hour, minute)
    const end = new Date(start.getTime() + Number(durationMinutes || 120) * 60 * 1000)
    return formatTimeRange12Hour(start, end)
  }

  if (fallbackLabel) {
    const parts = String(fallbackLabel).split(/\s*[–—-]\s*/)
    if (parts.length === 2) {
      return formatTimeRange12Hour(parts[0], parts[1])
    }
  }

  return formatTime12Hour(timeSlot)
}

export function formatDateTimeDisplay(dateInput, timeInput) {
  const date = formatOrderDate(dateInput)
  const time = formatTime12Hour(timeInput)
  if (date === '—' && time === '—') return '—'
  if (date === '—') return time
  if (time === '—') return date
  return `${date} ${time}`
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function formatMonthYear(date, t) {
  return t('dates.monthYear', {
    month: t(`dates.months.${MONTH_KEYS[date.getMonth()]}`),
    year: localizeDigits(date.getFullYear()),
  })
}

export function formatLongDate(date, t) {
  return t('dates.longDate', {
    weekday: t(`dates.weekdaysLong.${WEEKDAY_KEYS[date.getDay()]}`),
    day: localizeDigits(date.getDate()),
    month: t(`dates.months.${MONTH_KEYS[date.getMonth()]}`),
  })
}

export function formatMonthYearFromKey(monthKey, t) {
  const [year, month] = String(monthKey || '').split('-').map(Number)
  if (!year || !month) return monthKey
  return formatMonthYear(new Date(year, month - 1, 1), t)
}

export function parseOrderHour24(timeInput) {
  const raw = String(timeInput || '').trim()
  const twelveHourMatch = raw.match(TIME_12H_REGEX)
  if (twelveHourMatch) {
    let hour = Number.parseInt(twelveHourMatch[1], 10) % 12
    if (twelveHourMatch[3].toUpperCase() === 'PM') hour += 12
    return hour
  }

  const twentyFourHourMatch = raw.match(TIME_24H_REGEX)
  if (twentyFourHourMatch) {
    return Number.parseInt(twentyFourHourMatch[1], 10)
  }

  return 10
}

export function parseOrderTimestamp(order) {
  const date = formatOrderDate(order?.date)
  const hour = parseOrderHour24(order?.time)
  const minuteMatch = String(order?.time || '').match(/:(\d{2})/)
  const minute = minuteMatch ? Number.parseInt(minuteMatch[1], 10) : 0

  if (date === '—') return 0

  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0).getTime()
}

export function sortOrdersByDateTime(orders, direction = 'desc') {
  const sorted = [...orders].sort((a, b) => parseOrderTimestamp(a) - parseOrderTimestamp(b))
  return direction === 'desc' ? sorted.reverse() : sorted
}
