const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { isWithinReservedWindow, RESERVATION_LOCK_LEAD_MINUTES } = require('../src/utils/reservations')

// Booking today at 18:00 Phnom Penh time (UTC+7) for 120 minutes.
const booking = (status = 'Confirmed') => ({
  status,
  reservation_date: '2026-10-09',
  time_slot: '18:00',
  duration_minutes: 120,
})
const at = (hhmm) => new Date(`2026-10-09T${hhmm}:00+07:00`)

describe('reservation table lock window', () => {
  it('leaves the table free for walk-ins well before the booking', () => {
    assert.equal(isWithinReservedWindow(booking(), at('10:00')), false)
    assert.equal(isWithinReservedWindow(booking(), at('16:59')), false)
  })

  it('locks the table once the booking is within the lead time', () => {
    assert.equal(RESERVATION_LOCK_LEAD_MINUTES, 60)
    assert.equal(isWithinReservedWindow(booking(), at('17:00')), true)
    assert.equal(isWithinReservedWindow(booking(), at('17:45')), true)
    assert.equal(isWithinReservedWindow(booking(), at('18:30')), true)
  })

  it('releases the table after the booking ends', () => {
    assert.equal(isWithinReservedWindow(booking(), at('20:00')), false)
  })

  it('keeps a seated booking holding its table from the start of the day', () => {
    assert.equal(isWithinReservedWindow(booking('Seated'), at('10:00')), true)
  })

  it('ignores canceled and other-day bookings', () => {
    assert.equal(isWithinReservedWindow(booking('Canceled'), at('17:30')), false)
    assert.equal(isWithinReservedWindow({ ...booking(), reservation_date: '2026-10-10' }, at('17:30')), false)
  })
})
