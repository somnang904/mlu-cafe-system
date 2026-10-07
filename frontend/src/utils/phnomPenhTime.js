export const CAFE_TIME_ZONE = 'Asia/Phnom_Penh'

const PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAFE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function pad(value) {
  return String(value).padStart(2, '0')
}

export function phnomPenhParts(date = new Date()) {
  const parts = {}
  for (const part of PARTS_FORMAT.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  }
}

export function phnomPenhDayKey(date = new Date()) {
  const { year, month, day } = phnomPenhParts(date)
  return `${year}-${pad(month)}-${pad(day)}`
}

export function phnomPenhMonthKey(date = new Date()) {
  return phnomPenhDayKey(date).slice(0, 7)
}

export function weekdayOfDayKey(key) {
  const [year, month, day] = String(key).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function shiftDayKey(key, days) {
  const [year, month, day] = String(key).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function shiftMonthKey(monthKey, months) {
  const [year, month] = String(monthKey).split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

export function recentMonthKeys(count, now = new Date()) {
  const current = phnomPenhMonthKey(now)
  return Array.from({ length: count }, (_, index) => shiftMonthKey(current, -index))
}

export function msUntilNextPhnomPenhMidnight(now = new Date()) {
  const { hour, minute, second } = phnomPenhParts(now)
  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000 + now.getMilliseconds()
  return Math.max(1000, 86400000 - elapsed)
}
