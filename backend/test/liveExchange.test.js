const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { loadExchange } = require('../src/utils/liveConditions')

const nbc = { date: '2026-10-16', base: 'USD', quote: 'KHR', rate: 4067.0 }
const market = { time_last_update_utc: 'Sat, 17 Oct 2026 00:02:32 +0000', rates: { KHR: 4059.86 } }

describe('USD to KHR market rate', () => {
  it('uses the NBC official rate when it is available', async () => {
    const urls = []
    const result = await loadExchange(async (url) => { urls.push(url); return nbc })
    assert.equal(result.ok, true)
    assert.equal(result.khrPerUsd, 4067)
    assert.equal(result.source, 'NBC')
    assert.equal(result.updatedAt, '2026-10-16')
    assert.equal(urls.length, 1)
  })

  it('falls back to the market feed when NBC is unreachable', async () => {
    const result = await loadExchange(async (url) => {
      if (url.includes('frankfurter')) throw new Error('down')
      return market
    })
    assert.equal(result.ok, true)
    assert.equal(result.khrPerUsd, 4060)
    assert.equal(result.source, 'market')
  })

  it('falls back when NBC returns an unusable rate', async () => {
    const result = await loadExchange(async (url) => (url.includes('frankfurter') ? { quote: 'KHR', rate: 0 } : market))
    assert.equal(result.source, 'market')
  })

  it('reports unavailable when both feeds fail', async () => {
    const result = await loadExchange(async () => { throw new Error('offline') })
    assert.deepEqual(result, { ok: false, reason: 'exchange_unreachable' })
  })
})
