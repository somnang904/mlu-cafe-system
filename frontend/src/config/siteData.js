/**
 * Store schedule and public-facing hours for Mlu Kitchen & Cafe Siem Reap.
 * Single source of truth for reservation slots, banners, settings, and receipts.
 */
import { formatTimeRange12Hour } from '../utils/dateTimeFormat'

export const CLOSED_WEEKDAY = 1 // Monday (Date#getDay)

/** Nov–Mar tourist peak in Siem Reap. */
export const HIGH_SEASON_MONTHS = [11, 12, 1, 2, 3]

export const STORE_SCHEDULE = {
  lowSeason: {
    id: 'low',
    label: 'Low Season',
    openHour: 9,
    closeHour: 21,
    lastReservationStartHour: 20,
    hoursLabel: '9:00 AM - 9:00 PM',
  },
  highSeason: {
    id: 'high',
    label: 'High Season',
    openHour: 7,
    closeHour: 21,
    lastReservationStartHour: 20,
    hoursLabel: '7:00 AM - 9:00 PM',
  },
  weeklyOffDay: {
    weekday: CLOSED_WEEKDAY,
    label: 'Monday',
    notice: 'Closed on Mondays',
  },
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toHHmm(hour, minute = 0) {
  return `${pad2(hour)}:${pad2(minute)}`
}

function parseIsoDate(value) {
  const raw = String(value || '').slice(0, 10)
  const [year, month, day] = raw.split('-').map(Number)
  if (!year || !month || !day) return new Date()
  return new Date(year, month - 1, day)
}

export function isMonday(dateInput) {
  const date = dateInput instanceof Date ? dateInput : parseIsoDate(dateInput)
  return date.getDay() === CLOSED_WEEKDAY
}

export function isHighSeasonMonth(dateInput, seasonMode = 'auto') {
  if (seasonMode === 'high') return true
  if (seasonMode === 'low') return false
  const date = dateInput instanceof Date ? dateInput : parseIsoDate(dateInput)
  const month = date.getMonth() + 1
  return HIGH_SEASON_MONTHS.includes(month)
}

export function generateTimeSlots(isHighSeason) {
  const season = isHighSeason ? STORE_SCHEDULE.highSeason : STORE_SCHEDULE.lowSeason
  const slots = []
  const seen = new Set()

  for (let hour = season.openHour; hour + 2 <= season.closeHour; hour += 2) {
    const start = toHHmm(hour)
    const end = toHHmm(hour + 2)
    seen.add(start)
    slots.push({
      value: start,
      label: formatTimeRange12Hour(start, end),
      durationMinutes: 120,
    })
  }

  const lastStart = toHHmm(season.lastReservationStartHour)
  const lastEnd = toHHmm(season.closeHour)
  if (!seen.has(lastStart)) {
    slots.push({
      value: lastStart,
      label: formatTimeRange12Hour(lastStart, lastEnd),
      durationMinutes: 60,
    })
  }

  return slots
}

export function getTimeSlotsForDate(dateInput, seasonMode = 'auto') {
  if (isMonday(dateInput)) return []
  return generateTimeSlots(isHighSeasonMonth(dateInput, seasonMode))
}

export function nextOpenDate(from = new Date()) {
  const date = from instanceof Date ? new Date(from.getTime()) : parseIsoDate(from)
  while (date.getDay() === CLOSED_WEEKDAY) {
    date.setDate(date.getDate() + 1)
  }
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  return `${year}-${month}-${day}`
}

export function isValidReservationSlot(dateInput, timeSlot, seasonMode = 'auto') {
  if (isMonday(dateInput)) return false
  const start = String(timeSlot || '').slice(0, 5)
  return getTimeSlotsForDate(dateInput, seasonMode).some((slot) => slot.value === start)
}
