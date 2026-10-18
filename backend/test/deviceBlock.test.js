const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createMemorySecurityStore } = require('../src/utils/loginSecurity')
const { hasStrongDeviceId, isPrivateOrLoopbackIp } = require('../src/utils/deviceFingerprint')

const SHOP_IP = '203.0.113.10'
const BLOCKED = 'ab'.repeat(32)
const OTHER = 'cd'.repeat(32)

async function storeWithBlock(ip = SHOP_IP) {
  const store = createMemorySecurityStore()
  await store.blockDevice({ ip, fingerprint: BLOCKED, alertId: 1, blockedBy: 1 })
  return store
}

describe('blocked devices', () => {
  it('blocks the device that has the blocked id, whatever its IP', async () => {
    const store = await storeWithBlock()
    assert.equal(await store.isBlocked({ ip: '198.51.100.7', fingerprint: BLOCKED, strong: true }), true)
  })

  it('does not block another device on the same shop IP when it sends its own device id', async () => {
    const store = await storeWithBlock()
    assert.equal(await store.isBlocked({ ip: SHOP_IP, fingerprint: OTHER, strong: true }), false)
  })

  it('still blocks anonymous requests (no device id) from the blocked IP', async () => {
    const store = await storeWithBlock()
    assert.equal(await store.isBlocked({ ip: SHOP_IP, fingerprint: 'f'.repeat(64), strong: false }), true)
  })

  it('never blocks by a loopback or private IP, which could be every visitor behind a proxy', async () => {
    for (const ip of ['127.0.0.1', '::1', '10.0.0.5', '192.168.1.20', '172.20.0.3']) {
      const store = await storeWithBlock(ip)
      assert.equal(await store.isBlocked({ ip, fingerprint: OTHER, strong: false }), false, ip)
    }
  })
})

describe('device id helpers', () => {
  it('treats only a 64-hex X-Device-Id as a real device id', () => {
    const req = (value) => ({ headers: { 'x-device-id': value } })
    assert.equal(hasStrongDeviceId(req(OTHER)), true)
    assert.equal(hasStrongDeviceId(req('unknown-device')), false)
    assert.equal(hasStrongDeviceId({ headers: {} }), false)
  })

  it('recognises private and public addresses', () => {
    assert.equal(isPrivateOrLoopbackIp('::ffff:127.0.0.1'), true)
    assert.equal(isPrivateOrLoopbackIp('172.15.0.1'), false)
    assert.equal(isPrivateOrLoopbackIp('203.0.113.10'), false)
  })
})
