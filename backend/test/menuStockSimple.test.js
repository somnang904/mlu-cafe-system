const test = require('node:test')
const assert = require('node:assert/strict')
const {
  classifyDirectItemRows,
  rowsToArchive,
  deriveSingular,
  uniqueInventoryName,
  parseTrackBody,
  parseSettingsBody,
  resolveRestock,
  serializeMenuStockRow,
  summarizeMenuStockItems,
} = require('../src/utils/menuStockSimple')

const direct = (menu, inventory, qty) => ({
  menu_item_id: menu, variant: '', option_key: '', option_value: '', inventory_id: inventory, quantity_per_unit: qty,
})

test('a row linked one to one to a single menu item is kept', () => {
  const keep = classifyDirectItemRows([direct(1, 10, 1), direct(2, 11, '1.000000')])
  assert.deepEqual([...keep].sort(), [10, 11])
})

test('ingredient rows with fractional links or several menu items are archived', () => {
  const keep = classifyDirectItemRows([
    direct(1, 10, 0.018),
    direct(1, 11, 1),
    direct(2, 11, 1),
    direct(3, 12, 1),
    direct(3, 12, 2),
  ])
  assert.deepEqual([...keep], [])
})

test('a row with only variant links is not a direct item row', () => {
  const keep = classifyDirectItemRows([{ ...direct(1, 10, 1), variant: 'hot' }])
  assert.equal(keep.size, 0)
})

test('unlinked rows are archived and kept rows are not', () => {
  assert.deepEqual(rowsToArchive([1, 2, 3, 4], new Set([2, 4])), [1, 3])
})

test('unit singular is derived from the label', () => {
  assert.equal(deriveSingular('portions'), 'portion')
  assert.equal(deriveSingular('cups'), 'cup')
  assert.equal(deriveSingular('berries'), 'berry')
  assert.equal(deriveSingular('glass'), 'glass')
  assert.equal(deriveSingular('bottle'), 'bottle')
})

test('a taken name gets the stock suffix until it is unique', () => {
  assert.equal(uniqueInventoryName('Latte', ['Sugar']), 'Latte')
  assert.equal(uniqueInventoryName('Latte', ['latte']), 'Latte (stock)')
  assert.equal(uniqueInventoryName('Latte', ['Latte', 'Latte (stock)']), 'Latte (stock) (stock)')
})

test('track body gets defaults and a max of at least 50', () => {
  const value = parseTrackBody({ quantity: 12 })
  assert.equal(value.unit_label, 'portions')
  assert.equal(value.unit_singular, 'portion')
  assert.equal(value.low_threshold, 5)
  assert.equal(value.pack_size, null)
  assert.equal(value.max_stock, 50)
  assert.equal(parseTrackBody({ quantity: 80 }).max_stock, 80)
})

test('track body trims the unit and validates fields', () => {
  assert.equal(parseTrackBody({ quantity: 0, unit_label: '  cups ' }).unit_label, 'cups')
  for (const body of [
    {},
    { quantity: -1 },
    { quantity: 'x' },
    { quantity: 1, unit_label: 'x'.repeat(21) },
    { quantity: 1, unit_label: '   ' },
    { quantity: 1, pack_size: 1 },
    { quantity: 1, pack_size: 2.5 },
    { quantity: 1, low_threshold: -2 },
  ]) {
    assert.throws(() => parseTrackBody(body), (error) => error.status === 400)
  }
  assert.equal(parseTrackBody({ quantity: 1, pack_size: 24 }).pack_size, 24)
  assert.equal(parseTrackBody({ quantity: 1, pack_size: null }).pack_size, null)
})

test('settings body can clear the pack size and rejects empty changes', () => {
  assert.deepEqual(parseSettingsBody({ pack_size: null }), { pack_size: null })
  assert.equal(parseSettingsBody({ unit_label: 'bottles' }).unit_singular, 'bottle')
  assert.throws(() => parseSettingsBody({}), (error) => error.status === 400)
  assert.throws(() => parseSettingsBody({ pack_size: 1 }), (error) => error.status === 400)
})

test('set mode uses the typed amount, including zero', () => {
  assert.deepEqual(resolveRestock({ mode: 'set', quantity: 0 }, {}), { mode: 'set', quantity: 0 })
  assert.throws(() => resolveRestock({ mode: 'set' }, {}), (error) => error.status === 400)
})

test('add mode multiplies packs by the pack size', () => {
  assert.deepEqual(resolveRestock({ mode: 'add', packs: 2.5 }, { pack_size: 24 }), { mode: 'add', quantity: 60 })
})

test('adding packs without a pack size is rejected with its code', () => {
  assert.throws(
    () => resolveRestock({ mode: 'add', packs: 2 }, { pack_size: null }),
    (error) => error.status === 400 && error.code === 'no_pack_size',
  )
})

test('add mode needs a positive amount and a valid mode', () => {
  assert.deepEqual(resolveRestock({ mode: 'add', quantity: 6 }, {}), { mode: 'add', quantity: 6 })
  assert.throws(() => resolveRestock({ mode: 'add', quantity: 0 }, {}), (error) => error.status === 400)
  assert.throws(() => resolveRestock({ mode: 'add', packs: 0 }, { pack_size: 6 }), (error) => error.status === 400)
  assert.throws(() => resolveRestock({ mode: 'other', quantity: 1 }, {}), (error) => error.status === 400)
})

test('rows serialize as tracked or untracked', () => {
  const menu = { id: 5, name: 'Latte', category: 'Coffee', is_available: 1 }
  assert.deepEqual(serializeMenuStockRow(menu, null), {
    menu_item_id: 5,
    name: 'Latte',
    category: 'Coffee',
    is_available: true,
    tracked: false,
    inventory_id: null,
    stock_quantity: null,
    unit_label: null,
    unit_singular: null,
    pack_size: null,
    low_threshold: null,
    stock_status: null,
  })
  const tracked = serializeMenuStockRow(
    { ...menu, is_available: 0 },
    { id: '9', stock_quantity: '3.000000', unit_label: 'cups', unit_singular: 'cup', pack_size: 12, low_threshold: '5.000000' },
  )
  assert.equal(tracked.tracked, true)
  assert.equal(tracked.is_available, false)
  assert.equal(tracked.inventory_id, 9)
  assert.equal(tracked.stock_quantity, 3)
  assert.equal(tracked.pack_size, 12)
  assert.equal(tracked.stock_status, 'LOW_STOCK')
})

test('status follows quantity and the low level', () => {
  const menu = { id: 1, name: 'A', category: 'C' }
  const status = (quantity, low) => serializeMenuStockRow(menu, { id: 1, stock_quantity: quantity, low_threshold: low }).stock_status
  assert.equal(status(0, 5), 'OUT_OF_STOCK')
  assert.equal(status(5, 5), 'LOW_STOCK')
  assert.equal(status(6, 5), 'IN_STOCK')
  assert.equal(status(1, 0), 'IN_STOCK')
})

test('summary counts tracked, low and out', () => {
  const items = [
    { tracked: false, stock_status: null },
    { tracked: true, stock_status: 'IN_STOCK' },
    { tracked: true, stock_status: 'LOW_STOCK' },
    { tracked: true, stock_status: 'OUT_OF_STOCK' },
  ]
  assert.deepEqual(summarizeMenuStockItems(items), { total: 4, tracked: 3, untracked: 1, low: 1, out: 1 })
})

test('remove mode needs a positive amount, a reason and enough on hand', () => {
  const row = { stock_quantity: 10 }
  assert.deepEqual(resolveRestock({ mode: 'remove', quantity: 3, reason: 'waste' }, row), { mode: 'remove', quantity: 3, reason: 'waste' })
  assert.deepEqual(resolveRestock({ mode: 'remove', quantity: 10, reason: 'mistake' }, row), { mode: 'remove', quantity: 10, reason: 'mistake' })
  assert.throws(() => resolveRestock({ mode: 'remove', quantity: 0, reason: 'mistake' }, row), (error) => error.status === 400)
  assert.throws(() => resolveRestock({ mode: 'remove', quantity: 2 }, row), (error) => error.code === 'invalid_reason')
  assert.throws(() => resolveRestock({ mode: 'remove', quantity: 2, reason: 'other' }, row), (error) => error.code === 'invalid_reason')
  assert.throws(() => resolveRestock({ mode: 'remove', quantity: 11, reason: 'mistake' }, row), (error) => error.code === 'exceeds_stock')
})
