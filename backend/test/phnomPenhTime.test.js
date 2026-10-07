const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../frontend/src/utils/phnomPenhTime.js')).href);

test('day key follows Phnom Penh, not the machine time zone', async () => {
  const { phnomPenhDayKey, phnomPenhMonthKey } = await load();
  assert.equal(phnomPenhDayKey(new Date('2026-10-06T17:30:00Z')), '2026-10-07');
  assert.equal(phnomPenhDayKey(new Date('2026-10-06T16:59:59Z')), '2026-10-06');
  assert.equal(phnomPenhMonthKey(new Date('2026-09-30T17:00:00Z')), '2026-10');
});

test('day and month arithmetic on keys', async () => {
  const { shiftDayKey, shiftMonthKey, weekdayOfDayKey, recentMonthKeys } = await load();
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayKey('2024-12-31', 1), '2025-01-01');
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(weekdayOfDayKey('2026-10-07'), 3);
  const months = recentMonthKeys(24, new Date('2026-10-06T18:00:00Z'));
  assert.equal(months.length, 24);
  assert.equal(months[0], '2026-10');
  assert.equal(months[23], '2024-11');
});

test('time until next Phnom Penh midnight', async () => {
  const { msUntilNextPhnomPenhMidnight } = await load();
  assert.equal(msUntilNextPhnomPenhMidnight(new Date('2026-10-07T16:00:00.000Z')), 60 * 60 * 1000);
});
