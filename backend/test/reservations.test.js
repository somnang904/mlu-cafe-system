const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  parsePayload,
  rangesOverlap,
  todayIso,
  isRealDate,
  addDaysIso,
  formatDate,
  slotWindow,
} = require('../src/utils/reservations')
const { buildLetterFields } = require('../src/utils/reservationLetter')

const base = {
  customer_name: 'Dara',
  phone: '012 345 678',
  reservation_date: '2026-11-10',
  time_slot: '19:00',
  table_id: 1,
  guest_count: 2,
  status: 'Confirmed',
}

function statusOf(fn) {
  try {
    fn()
    return 200
  } catch (error) {
    return error.status || 500
  }
}

describe('reservation dates are Cambodia time', () => {
  it('today switches at midnight in Phnom Penh, not on the host clock', () => {
    assert.equal(todayIso(new Date('2026-10-07T17:30:00Z')), '2026-10-08')
    assert.equal(todayIso(new Date('2026-10-07T16:59:00Z')), '2026-10-07')
  })

  it('a DATE read as midnight +07:00 keeps its calendar day', () => {
    assert.equal(formatDate(new Date('2026-10-08T00:00:00+07:00')), '2026-10-08')
  })

  it('adds days without host timezone drift', () => {
    assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01')
    assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28')
  })

  it('slot windows are anchored to +07:00', () => {
    assert.equal(slotWindow('2026-10-08', '19:00', 120).start.toISOString(), '2026-10-08T12:00:00.000Z')
  })
})

describe('reservation payload validation', () => {
  const today = '2026-10-07'

  it('rejects impossible and past dates', () => {
    assert.equal(isRealDate('2026-02-31'), false)
    assert.equal(statusOf(() => parsePayload({ ...base, reservation_date: '2026-02-31' }, { today })), 400)
    assert.equal(statusOf(() => parsePayload({ ...base, reservation_date: '2026-10-06' }, { today })), 400)
  })

  it('allows editing a past booking when the date is unchanged', () => {
    const existing = { ...base, reservation_date: '2026-10-06' }
    assert.equal(statusOf(() => parsePayload({ ...existing, status: 'Completed' }, { today, existing })), 200)
  })

  it('enforces length, phone and guest count rules', () => {
    assert.equal(statusOf(() => parsePayload({ ...base, customer_name: 'x'.repeat(161) }, { today })), 400)
    assert.equal(statusOf(() => parsePayload({ ...base, phone: 'call me 012345678' }, { today })), 400)
    assert.equal(statusOf(() => parsePayload({ ...base, notes: 'n'.repeat(1001) }, { today })), 400)
    assert.equal(statusOf(() => parsePayload({ ...base, guest_count: '2.5' }, { today })), 400)
    assert.equal(statusOf(() => parsePayload({ ...base, guest_count: 0 }, { today })), 400)
  })

  it('takes the duration from the slot, never from the client', () => {
    const data = parsePayload({ ...base, duration_minutes: 600 }, { today })
    assert.equal(data.durationMinutes, 120)
    assert.equal(parsePayload({ ...base, time_slot: '20:00' }, { today }).durationMinutes, 60)
  })

  it('requires a real slot for seated bookings too', () => {
    assert.equal(statusOf(() => parsePayload({ ...base, time_slot: '22:00', status: 'Seated' }, { today })), 400)
  })
})

describe('reservation time ranges', () => {
  it('19:00-21:00 overlaps 20:00-21:00 but not 17:00-19:00', () => {
    assert.equal(rangesOverlap('19:00', 120, '20:00', 60), true)
    assert.equal(rangesOverlap('17:00', 120, '19:00', 120), false)
  })
})

describe('confirmation letter wording', () => {
  it('does not claim a pending booking is confirmed', () => {
    assert.equal(buildLetterFields({ status: 'Pending' }).heading, 'Booking Received')
    assert.equal(buildLetterFields({ status: 'Confirmed' }).heading, 'Booking Confirmed!')
  })
})
