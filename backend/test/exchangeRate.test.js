const test = require('node:test')
const assert = require('node:assert/strict')

const { getExchangeRate, setExchangeRate, SETTING_KEY } = require('../src/utils/exchangeRate')
const { DEFAULT_EXCHANGE_RATE } = require('../src/utils/cashDrawer')

/** In-memory stand-in for the app_settings table. */
function fakeDb(initial = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    rows,
    async execute(sql, params = []) {
      if (/CREATE TABLE/i.test(sql)) return [[]]
      if (/^\s*SELECT/i.test(sql)) {
        return [rows.has(params[0]) ? [{ setting_value: rows.get(params[0]) }] : []]
      }
      if (/INSERT INTO app_settings/i.test(sql)) {
        rows.set(params[0], params[1])
        return [{}]
      }
      throw new Error(`unexpected sql: ${sql}`)
    },
  }
}

test('falls back to the default until an admin sets a rate', async () => {
  assert.equal(await getExchangeRate(fakeDb()), DEFAULT_EXCHANGE_RATE)
})

test('returns the stored rate after it is set', async () => {
  const db = fakeDb()
  assert.equal(await setExchangeRate(db, 4000), 4000)
  assert.equal(await getExchangeRate(db), 4000)
  assert.equal(db.rows.get(SETTING_KEY), '4000')
})

test('a numeric string from a form is accepted', async () => {
  const db = fakeDb()
  assert.equal(await setExchangeRate(db, ' 4050 '), 4050)
})

test('rejects a rate outside the allowed range with a 400', async () => {
  const db = fakeDb()
  for (const bad of [0, 999, 10001, -4100]) {
    await assert.rejects(setExchangeRate(db, bad), (error) => error.status === 400, `rate ${bad}`)
  }
  assert.equal(db.rows.size, 0, 'nothing is stored for a rejected rate')
})

test('rejects a rate that is not a whole number', async () => {
  const db = fakeDb()
  for (const bad of [4100.5, 'abc', '', null, undefined, NaN]) {
    await assert.rejects(setExchangeRate(db, bad), (error) => error.status === 400, `rate ${String(bad)}`)
  }
})

test('ignores a stored value that is no longer valid', async () => {
  assert.equal(await getExchangeRate(fakeDb({ [SETTING_KEY]: 'garbage' })), DEFAULT_EXCHANGE_RATE)
  assert.equal(await getExchangeRate(fakeDb({ [SETTING_KEY]: '50' })), DEFAULT_EXCHANGE_RATE)
})
