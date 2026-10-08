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

export const OPERATING_HOURS_NOTICE =
  'Operating Hours: Low Season (9:00 AM - 9:00 PM) | High Season (7:00 AM - 9:00 PM) | Closed Mondays'

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

export function getSeasonForDate(dateInput, seasonMode = 'auto') {
  return isHighSeasonMonth(dateInput, seasonMode) ? STORE_SCHEDULE.highSeason : STORE_SCHEDULE.lowSeason
}

export function generateTimeSlots(isHighSeason) {
  const season = isHighSeason ? STORE_SCHEDULE.highSeason : STORE_SCHEDULE.lowSeason
  const slots = []
  const closeMinutes = season.closeHour * 60
  const lastReservationMinutes = (season.lastReservationStartHour || 20) * 60 + 30

  for (let totalMin = season.openHour * 60; totalMin <= lastReservationMinutes; totalMin += 30) {
    const hour = Math.floor(totalMin / 60)
    const minute = totalMin % 60
    const start = toHHmm(hour, minute)

    const remainingMin = closeMinutes - totalMin
    const durationMinutes = Math.min(120, Math.max(30, remainingMin))

    const endTotalMin = totalMin + durationMinutes
    const endHour = Math.floor(endTotalMin / 60)
    const endMinute = endTotalMin % 60
    const end = toHHmm(endHour, endMinute)

    slots.push({
      value: start,
      label: formatTimeRange12Hour(start, end),
      durationMinutes,
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
  const raw = String(timeSlot || '').trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return false
  const hour = Number.parseInt(match[1], 10)
  const minute = Number.parseInt(match[2], 10)
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return false
  const timeMinutes = hour * 60 + minute
  const season = getSeasonForDate(dateInput, seasonMode)
  const openMinutes = season.openHour * 60
  const lastReservationMinutes = (season.lastReservationStartHour || 20) * 60 + 30
  return timeMinutes >= openMinutes && timeMinutes <= lastReservationMinutes
}
