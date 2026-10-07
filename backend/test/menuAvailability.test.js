const test = require('node:test')
const assert = require('node:assert/strict')

const {
  MENU_DELETE_COOLDOWN_DAYS,
  computeMenuDeleteEligibility,
  normalizeMenuItemName,
  parseOptionalAvailability,
} = require('../src/utils/menuLifecycle')
const { serializeMenuItem } = require('../src/utils/menuItemsSchema')

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-10-20T12:00:00.000Z')

test('cooldown is seven days', () => {
  assert.equal(MENU_DELETE_COOLDOWN_DAYS, 7)
})

test('an item with no sales can always be deleted', () => {
  const expected = { can_delete: true, delete_block_reason: null, delete_available_at: null }
  assert.deepEqual(computeMenuDeleteEligibility({ has_sales: false, is_available: true, unavailable_since: null, now }), expected)
  assert.deepEqual(computeMenuDeleteEligibility({ has_sales: false, is_available: false, unavailable_since: now, now }), expected)
})

test('an item with sales that is on sale cannot be deleted', () => {
  assert.deepEqual(
    computeMenuDeleteEligibility({ has_sales: true, is_available: true, unavailable_since: null, now }),
    { can_delete: false, delete_block_reason: 'on_sale', delete_available_at: null },
  )
})

test('an item with sales that went off sale less than seven days ago is cooling down', () => {
  const since = new Date(now.getTime() - 3 * DAY)
  assert.deepEqual(
    computeMenuDeleteEligibility({ has_sales: true, is_available: false, unavailable_since: since, now }),
    {
      can_delete: false,
      delete_block_reason: 'cooling_down',
      delete_available_at: new Date(since.getTime() + 7 * DAY).toISOString(),
    },
  )
})

test('the cooldown ends exactly seven days after the item went off sale', () => {
  const justBefore = new Date(now.getTime() - 7 * DAY + 1)
  const exactly = new Date(now.getTime() - 7 * DAY)
  assert.equal(computeMenuDeleteEligibility({ has_sales: true, is_available: false, unavailable_since: justBefore, now }).can_delete, false)
  assert.deepEqual(
    computeMenuDeleteEligibility({ has_sales: true, is_available: false, unavailable_since: exactly, now }),
    { can_delete: true, delete_block_reason: null, delete_available_at: null },
  )
  assert.equal(
    computeMenuDeleteEligibility({ has_sales: true, is_available: false, unavailable_since: new Date(now.getTime() - 30 * DAY), now }).can_delete,
    true,
  )
})

test('an off-sale item with sales and no recorded time starts cooling down now', () => {
  const result = computeMenuDeleteEligibility({ has_sales: true, is_available: false, unavailable_since: null, now })
  assert.equal(result.delete_block_reason, 'cooling_down')
  assert.equal(result.delete_available_at, new Date(now.getTime() + 7 * DAY).toISOString())
})

test('normalizeMenuItemName trims and enforces 1-100 characters', () => {
  assert.deepEqual(normalizeMenuItemName('  Latte  '), { name: 'Latte' })
  assert.equal(normalizeMenuItemName('   ').code, 'required')
  assert.equal(normalizeMenuItemName(undefined).code, 'required')
  assert.equal(normalizeMenuItemName(42).code, 'required')
  assert.equal(normalizeMenuItemName('a'.repeat(100)).name.length, 100)
  assert.equal(normalizeMenuItemName('a'.repeat(101)).code, 'too_long')
})

test('parseOptionalAvailability accepts booleans and rejects anything else', () => {
  assert.deepEqual(parseOptionalAvailability(undefined), { value: undefined })
  assert.deepEqual(parseOptionalAvailability(true), { value: true })
  assert.deepEqual(parseOptionalAvailability(false), { value: false })
  assert.ok(parseOptionalAvailability('yes').error)
  assert.ok(parseOptionalAvailability(null).error)
})

test('serializeMenuItem exposes availability and delete eligibility', () => {
  const since = new Date(now.getTime() - 2 * DAY)
  const item = serializeMenuItem(
    { id: 1, name: 'Soup', category: 'Soup', price: '3.50', is_available: 0, unavailable_since: since, has_sales: 1 },
    now,
  )
  assert.equal(item.is_available, false)
  assert.equal(item.unavailable_since, since.toISOString())
  assert.equal(item.has_sales, true)
  assert.equal(item.can_delete, false)
  assert.equal(item.delete_block_reason, 'cooling_down')
  assert.equal(item.delete_available_at, new Date(since.getTime() + 7 * DAY).toISOString())

  const fresh = serializeMenuItem({ id: 2, name: 'Tea', category: 'Tea', price: 1, is_available: 1 }, now)
  assert.equal(fresh.has_sales, false)
  assert.equal(fresh.can_delete, true)
  assert.equal(fresh.unavailable_since, null)
})
