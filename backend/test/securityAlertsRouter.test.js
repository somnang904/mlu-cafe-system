const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const { createMemorySecurityStore } = require('../src/utils/loginSecurity')
const { createSecurityAlertsRouter } = require('../src/routes/securityAlerts')

const ADMIN_DEVICE = 'aa'.repeat(32)
const ATTACKER_DEVICE = 'bb'.repeat(32)
const SHOP_IP = '203.0.113.10'

async function withServer(store, work) {
  const app = express()
  app.use((req, _res, next) => {
    // What the blocked-device middleware and auth normally provide.
    req.deviceFingerprint = String(req.headers['x-device-id'] || '')
    req.clientIp = SHOP_IP
    req.user = { id: 1, username: 'admin', role: 'Admin' }
    next()
  })
  app.use('/api/security-alerts', createSecurityAlertsRouter({ store, requireAdmin: (_req, _res, next) => next() }))
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/security-alerts`
  const call = async (path, { method = 'GET', device = ADMIN_DEVICE } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'x-device-id': device } })
    return { status: res.status, body: await res.json() }
  }
  try {
    await work(call)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function storeWithAlert(fingerprint = ATTACKER_DEVICE) {
  const store = createMemorySecurityStore()
  const alert = await store.insertAlert({
    username: 'admin', ipAddress: SHOP_IP, userAgent: 'x', browser: 'Chrome', osName: 'Android',
    deviceType: 'Mobile', deviceFingerprint: fingerprint, location: 'Phnom Penh', failedAttempts: 4,
    stage: 1, createdAt: new Date(),
  })
  return { store, alert }
}

describe('security alerts: block and unblock a device', () => {
  it('blocks another device, lists it, and the blocked device is then refused', async () => {
    const { store, alert } = await storeWithAlert()
    await withServer(store, async (call) => {
      const blocked = await call(`/${alert.id}/block`, { method: 'POST' })
      assert.equal(blocked.status, 200)
      assert.equal(blocked.body.alert.status, 'BLOCKED')

      const list = await call('/blocked')
      assert.equal(list.body.devices.length, 1)
      assert.equal(list.body.devices[0].username, 'admin')
    })
    assert.equal(await store.isBlocked({ ip: SHOP_IP, fingerprint: ATTACKER_DEVICE, strong: true }), true)
    assert.equal(await store.isBlocked({ ip: SHOP_IP, fingerprint: ADMIN_DEVICE, strong: true }), false)
  })

  it('refuses to block the device the admin is using', async () => {
    const { store, alert } = await storeWithAlert(ADMIN_DEVICE)
    await withServer(store, async (call) => {
      const result = await call(`/${alert.id}/block`, { method: 'POST' })
      assert.equal(result.status, 400)
      assert.match(result.body.message, /cannot block the device you are using/)
    })
    assert.equal((await store.listBlocked()).length, 0)
  })

  it('unblocks from the blocked list and clears the BLOCKED status on the alert', async () => {
    const { store, alert } = await storeWithAlert()
    await withServer(store, async (call) => {
      await call(`/${alert.id}/block`, { method: 'POST' })
      const [device] = (await call('/blocked')).body.devices
      const result = await call(`/blocked/${device.id}/unblock`, { method: 'POST' })
      assert.equal(result.status, 200)
      assert.equal((await call('/blocked')).body.devices.length, 0)
      assert.equal((await call(`/blocked/999/unblock`, { method: 'POST' })).status, 404)
    })
    assert.equal((await store.getAlert(alert.id)).status, 'REVIEWED')
  })
})
