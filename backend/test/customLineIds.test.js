const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const Module = require('node:module')

const {
  billMatchesBase,
  insertOrderItem,
  parseMenuItemId,
  parseMenuItemIdFromItem,
  pickLinePrices,
  validateOrderLine,
} = require('../src/utils/orderTargets')

const FRONTEND_UTILS = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'utils')

function fakeDb(menuRows = {}) {
  const calls = []
  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params })
      if (/FROM menu_items WHERE id = \?/.test(sql)) {
        const row = menuRows[params[0]]
        return [row ? [{ id: params[0], ...row }] : []]
      }
      if (/INFORMATION_SCHEMA|SHOW COLUMNS/i.test(sql)) return [[{ COLUMN_NAME: 'x' }]]
      if (/^INSERT INTO order_items/.test(sql)) return [{ insertId: 1 }]
      if (/FROM order_items WHERE order_id/.test(sql)) return [[]]
      return [[]]
    },
  }
}

test('parseMenuItemId accepts only whole positive integers', () => {
  assert.equal(parseMenuItemId(7), 7)
  assert.equal(parseMenuItemId('7'), 7)
  assert.equal(parseMenuItemId('0012'), 12)
  assert.equal(parseMenuItemId('7Up'), null)
  assert.equal(parseMenuItemId('2 Eggs'), null)
  assert.equal(parseMenuItemId('7Up::'), null)
  assert.equal(parseMenuItemId('12::Iced'), null)
  assert.equal(parseMenuItemId('7.5'), null)
  assert.equal(parseMenuItemId(7.5), null)
  assert.equal(parseMenuItemId(' 7'), null)
  assert.equal(parseMenuItemId('-3'), null)
  assert.equal(parseMenuItemId(0), null)
  assert.equal(parseMenuItemId('0'), null)
  assert.equal(parseMenuItemId(''), null)
  assert.equal(parseMenuItemId(null), null)
  assert.equal(parseMenuItemId(undefined), null)
  assert.equal(parseMenuItemId(Number.NaN), null)
  assert.equal(parseMenuItemId('99999999999999999999'), null)
})

test('a custom line named with leading digits is not a menu item', () => {
  assert.equal(parseMenuItemIdFromItem({ id: '7Up::', name: '7Up', menu_item_id: null }), null)
  assert.equal(parseMenuItemIdFromItem({ id: '2 Eggs', name: '2 Eggs' }), null)
  assert.equal(parseMenuItemIdFromItem({ id: 7, name: 'Latte' }), 7)
  assert.equal(parseMenuItemIdFromItem({ menu_item_id: '7', id: '7::Iced' }), 7)
})

test('a non-admin cannot slip a custom 7Up line through as menu item 7', () => {
  const line = { id: '7Up::', name: '7Up', quantity: 1, price: 1.5 }
  assert.equal(validateOrderLine(line, { isAdmin: false }), 'Only an administrator can add a line that is not on the menu')
  assert.equal(validateOrderLine(line, { isAdmin: true }), null)
})

test('a custom 7Up line keeps its own price and is saved without a menu id', async () => {
  const db = fakeDb({ 7: { price: 9, hot_price: null, iced_price: null } })
  const saved = await insertOrderItem(db, 10, { id: '7Up::', name: '7Up', quantity: 2, price: 1.5 })
  assert.equal(saved.menuItemId, null)
  assert.equal(db.calls.some((call) => /FROM menu_items/.test(call.sql)), false)
  const insert = db.calls.find((call) => /^INSERT INTO order_items/.test(call.sql))
  assert.equal(insert.params[1], null)
  assert.ok(insert.params.includes(1.5))
  assert.ok(insert.params.includes(3))
})

test('pickLinePrices does not borrow menu item 7 saved price for a custom 7Up line', async () => {
  const db = {
    async execute() {
      return [[{ menu_item_id: 7, notes: '', price: 9 }]]
    },
  }
  const prices = await pickLinePrices(db, 1, [{ id: '7Up::', name: '7Up', quantity: 1 }], { isAdmin: false })
  assert.deepEqual(prices, [null])
})

test('billMatchesBase keeps a custom 7Up line apart from menu item 7', () => {
  const saved = [{ menu_item_id: 7, item_name: 'Latte', notes: '', quantity: 1 }]
  const base = [{ menu_item_id: '7Up', name: '7Up', notes: '', quantity: 1 }]
  assert.equal(billMatchesBase(saved, base), false)
  assert.equal(billMatchesBase(saved, [{ menu_item_id: '7', name: 'Latte', notes: '', quantity: 1 }]), true)
})

let frontendHooksReady = false
function registerFrontendResolver() {
  if (frontendHooksReady) return true
  if (typeof Module.registerHooks !== 'function') return false
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.includes('/frontend/src/')) {
        const candidate = new URL(`${specifier}.js`, context.parentURL)
        if (fs.existsSync(candidate)) return nextResolve(candidate.href, context)
      }
      return nextResolve(specifier, context)
    },
  })
  frontendHooksReady = true
  return true
}

async function importFrontend(file) {
  return import(pathToFileURL(path.join(FRONTEND_UTILS, file)).href)
}

const canLoadFrontend = typeof Module.registerHooks === 'function'

test('frontend parseMenuItemId matches the backend rule', { skip: !canLoadFrontend }, async () => {
  registerFrontendResolver()
  const { parseMenuItemId: frontParse } = await importFrontend('posHelpers.js')
  for (const value of [7, '7', '7Up', '2 Eggs', '7Up::', '12::Iced', '7.5', 0, '', null, undefined, -1]) {
    assert.equal(frontParse(value), parseMenuItemId(value), `value ${String(value)}`)
  }
})

test('frontend normalizeBillItem leaves a custom 7Up line without a menu id', { skip: !canLoadFrontend }, async () => {
  registerFrontendResolver()
  const { normalizeBillItem } = await importFrontend('posHelpers.js')
  const custom = normalizeBillItem({ id: '7Up::', menu_item_id: null, name: '7Up', qty: 1, unitPrice: 1.5 })
  assert.equal(custom.menu_item_id, null)
  assert.equal(custom.id, '7Up::')
  const eggs = normalizeBillItem({ id: '2 Eggs::', menu_item_id: null, name: '2 Eggs', qty: 1, unitPrice: 3 })
  assert.equal(eggs.menu_item_id, null)
  const menu = normalizeBillItem({ id: '7::', menu_item_id: 7, name: 'Latte', qty: 1, unitPrice: 2 })
  assert.equal(menu.menu_item_id, 7)
})

test('frontend mergeCartIntoItems does not merge a menu item 7 into a custom 7Up line', { skip: !canLoadFrontend }, async () => {
  registerFrontendResolver()
  const { mergeCartIntoItems, normalizeBillItem } = await importFrontend('posHelpers.js')
  const bill = [normalizeBillItem({ id: '7Up::', menu_item_id: null, name: '7Up', qty: 1, unitPrice: 1.5 })]
  const merged = mergeCartIntoItems(bill, [{ id: '7::', menu_item_id: 7, name: 'Latte', qty: 1, unitPrice: 2 }])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].qty, 1)
  assert.equal(merged[0].menu_item_id, null)
  assert.equal(merged[1].menu_item_id, 7)
})

test('frontend groupActiveRows keeps custom 2 Eggs apart from menu item 2', { skip: !canLoadFrontend }, async () => {
  registerFrontendResolver()
  const { groupActiveRows } = await importFrontend('activeOrdersStorage.js')
  const grouped = groupActiveRows([
    { target_id: '3', menu_item_id: 2, name: 'Espresso', notes: '', quantity: 1, price: 2 },
    { target_id: '3', menu_item_id: null, name: '2 Eggs', notes: '', quantity: 1, price: 3 },
  ])
  const lines = grouped['3']
  assert.equal(lines.length, 2)
  const eggs = lines.find((line) => line.name === '2 Eggs')
  assert.equal(eggs.menu_item_id, null)
  assert.equal(eggs.unitPrice, 3)
})
