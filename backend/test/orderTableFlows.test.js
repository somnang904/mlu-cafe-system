const test = require('node:test')
const assert = require('node:assert/strict')
const { planStockDeltas, withTransaction } = require('../src/utils/stockLedger')
const {
  billMatchesBase,
  pendingOrderLockName,
  tableLockName,
  normalizeIncomingTarget,
} = require('../src/utils/orderTargets')

const beerLink = { menu_item_id: 125, inventory_id: 12, quantity_per_unit: 1 }

function fakePool({ lockGranted = true, failRelease = false } = {}) {
  const log = []
  const conn = {
    async query(sql, params) {
      if (sql.includes('GET_LOCK')) {
        log.push(`lock ${params[0]}`)
        return [[{ ok: lockGranted ? 1 : 0 }]]
      }
      if (sql.includes('RELEASE_LOCK')) {
        log.push(`unlock ${params[0]}`)
        if (failRelease) throw new Error('connection lost')
        return [[{ ok: 1 }]]
      }
      throw new Error(`unexpected query ${sql}`)
    },
    async beginTransaction() { log.push('begin') },
    async commit() { log.push('commit') },
    async rollback() { log.push('rollback') },
    release() { log.push('release') },
    destroy() { log.push('destroy') },
  }
  return { log, pool: { getConnection: async () => conn } }
}

test('a table bill and its lock name use the same key whichever way the target is written', () => {
  assert.equal(pendingOrderLockName(normalizeIncomingTarget('3')), tableLockName(3))
  assert.equal(pendingOrderLockName(normalizeIncomingTarget(' 03 ')), tableLockName('3'))
  assert.equal(pendingOrderLockName(normalizeIncomingTarget('Take Out')), 'pending-order:takeout')
})

test('table locks are taken before the transaction and released after commit', async () => {
  const { log, pool } = fakePool()
  const result = await withTransaction(pool, async () => {
    log.push('work')
    return 7
  }, { locks: [tableLockName(5), tableLockName(2)] })

  assert.equal(result, 7)
  assert.deepEqual(log, [
    'lock pending-order:2',
    'lock pending-order:5',
    'begin',
    'work',
    'commit',
    'unlock pending-order:5',
    'unlock pending-order:2',
    'release',
  ])
})

test('locks are released when the work fails', async () => {
  const { log, pool } = fakePool()
  await assert.rejects(
    withTransaction(pool, async () => { throw new Error('boom') }, { locks: ['pending-order:1'] }),
    /boom/,
  )
  assert.deepEqual(log, ['lock pending-order:1', 'begin', 'rollback', 'unlock pending-order:1', 'release'])
})

test('a lock that is not granted in time is a 409 and nothing runs', async () => {
  const { log, pool } = fakePool({ lockGranted: false })
  let ran = false
  await assert.rejects(
    withTransaction(pool, async () => { ran = true }, { locks: ['pending-order:1'] }),
    (error) => error.status === 409,
  )
  assert.equal(ran, false)
  assert.ok(!log.includes('begin'))
  assert.equal(log.at(-1), 'release')
})

test('a connection that may still hold a lock is not returned to the pool', async () => {
  const { log, pool } = fakePool({ failRelease: true })
  await withTransaction(pool, async () => {}, { locks: ['pending-order:1'] })
  assert.equal(log.at(-1), 'destroy')
  assert.ok(!log.includes('release'))
})

test('without locks the transaction behaves as before', async () => {
  const { log, pool } = fakePool()
  await withTransaction(pool, async () => {})
  assert.deepEqual(log, ['begin', 'commit', 'release'])
})

test('the bill matches what the device saw, in any order and split across rows', () => {
  const saved = [
    { menu_item_id: 125, item_name: 'Cambodia', notes: null, quantity: 2 },
    { menu_item_id: 125, item_name: 'Cambodia', notes: null, quantity: 1 },
    { menu_item_id: 40, item_name: 'Iced Latte', notes: 'Sugar: 50%', quantity: 1 },
  ]
  const seen = [
    { menu_item_id: 40, name: 'Iced Latte (Sugar: 50%)', notes: 'Sugar: 50% ', quantity: 1 },
    { menu_item_id: 125, name: 'Cambodia', notes: '', quantity: 3 },
  ]
  assert.equal(billMatchesBase(saved, seen), true)
})

test('lines another device added make the bill stale', () => {
  const saved = [{ menu_item_id: 125, notes: null, quantity: 5 }]
  assert.equal(billMatchesBase(saved, [{ menu_item_id: 125, notes: '', quantity: 2 }]), false)
  assert.equal(
    billMatchesBase(
      [...saved, { menu_item_id: 7, notes: null, quantity: 1 }],
      [{ menu_item_id: 125, notes: '', quantity: 5 }],
    ),
    false,
  )
})

test('a bill paid elsewhere does not match a device that still shows its lines', () => {
  assert.equal(billMatchesBase([], [{ menu_item_id: 125, quantity: 2 }]), false)
  assert.equal(billMatchesBase([], []), true)
})

test('custom lines match by name whether or not the notes were already appended', () => {
  const saved = [{ menu_item_id: null, item_name: 'Birthday cake', notes: 'no candles', quantity: 1 }]
  assert.equal(
    billMatchesBase(saved, [{ menu_item_id: null, name: 'Birthday cake (no candles)', notes: 'no candles', quantity: 1 }]),
    true,
  )
  assert.equal(
    billMatchesBase(saved, [{ menu_item_id: null, name: 'Wedding cake', notes: 'no candles', quantity: 1 }]),
    false,
  )
})

test('a price edit alone is not a conflict', () => {
  const saved = [{ menu_item_id: 125, notes: null, quantity: 2, price: 1.5 }]
  assert.equal(billMatchesBase(saved, [{ menu_item_id: 125, quantity: 2, price: 1 }]), true)
})

test('merging two tables moves their stock instead of deducting it again', () => {
  const sourceBack = planStockDeltas([], [beerLink], new Map([[12, 3]]))
  assert.deepEqual(sourceBack, [{ inventoryId: 12, delta: -3 }])

  const merged = [{ menu_item_id: 125, quantity: 2 }, { menu_item_id: 125, quantity: 3 }]
  const hostTakes = planStockDeltas(merged, [beerLink], new Map([[12, 2]]))
  assert.deepEqual(hostTakes, [{ inventoryId: 12, delta: 3 }])

  assert.deepEqual(planStockDeltas(merged, [beerLink], new Map([[12, 5]])), [])
})
