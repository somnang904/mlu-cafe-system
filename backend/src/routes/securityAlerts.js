const express = require('express')
const { logSecurity } = require('../utils/logger')
const { hasStrongDeviceId } = require('../utils/deviceFingerprint')
const { publish } = require('../utils/realtime')

function createSecurityAlertsRouter({ store, requireAdmin }) {
  const router = express.Router()
  router.use(requireAdmin)

  router.get('/', async (req, res) => {
    const status = String(req.query.status || 'ALL').toUpperCase()
    const allowed = new Set(['ALL', 'NEW', 'REVIEWED', 'BLOCKED'])
    const alerts = await store.listAlerts({ status: allowed.has(status) ? status : 'ALL' })
    res.status(200).json({ alerts })
  })

  // Devices that are blocked right now (the blocked_devices table), not just alerts marked BLOCKED.
  router.get('/blocked', async (_req, res) => {
    const devices = await store.listBlocked()
    res.status(200).json({ devices })
  })

  router.post('/blocked/:id/unblock', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid blocked device id' })
    }
    const removed = await store.unblockById(id)
    if (!removed) return res.status(404).json({ message: 'Blocked device not found' })
    if (removed.alertId) {
      const alert = await store.getAlert(removed.alertId)
      if (alert?.status === 'BLOCKED') await store.updateAlertStatus(removed.alertId, 'REVIEWED')
    }
    logSecurity('device_block_removed', { blockedId: id, reviewer: req.user?.username })
    publish('security')
    return res.status(200).json({ ok: true })
  })

  router.post('/:id/review', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid alert id' })
    }
    const existing = await store.getAlert(id)
    if (!existing) return res.status(404).json({ message: 'Alert not found' })

    const alert = existing.status === 'BLOCKED'
      ? existing
      : await store.updateAlertStatus(id, 'REVIEWED')
    logSecurity('security_alert_reviewed', {
      ip: req.clientIp || req.ip,
      alertId: id,
      username: existing.username,
      reviewer: req.user?.username,
    })
    publish('security')
    publish('alerts')
    return res.status(200).json({ alert })
  })

  router.post('/:id/block', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid alert id' })
    }
    const existing = await store.getAlert(id)
    if (!existing) return res.status(404).json({ message: 'Alert not found' })
    if (!existing.deviceFingerprint) {
      return res.status(400).json({ message: 'This alert has no device fingerprint to block' })
    }

    // An admin must never lock themselves out: the block check runs before sign-in.
    const sameDevice = req.deviceFingerprint && existing.deviceFingerprint === req.deviceFingerprint
    const sameWeakIp = !hasStrongDeviceId(req) && existing.ipAddress === req.clientIp
    if (sameDevice || sameWeakIp) {
      return res.status(400).json({ message: 'You cannot block the device you are using.' })
    }

    await store.blockDevice({
      ip: existing.ipAddress,
      fingerprint: existing.deviceFingerprint,
      alertId: existing.id,
      blockedBy: req.user?.id || null,
    })
    const alert = await store.updateAlertStatus(id, 'BLOCKED')
    logSecurity('device_block_added', {
      ip: existing.ipAddress,
      fingerprint: existing.deviceFingerprint,
      alertId: id,
      username: existing.username,
      blockedBy: req.user?.username,
    })
    publish('security')
    publish('alerts')
    return res.status(200).json({ alert })
  })

  router.post('/:id/unblock', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid alert id' })
    }
    const existing = await store.getAlert(id)
    if (!existing) return res.status(404).json({ message: 'Alert not found' })

    await store.unblockDevice({
      ip: existing.ipAddress,
      fingerprint: existing.deviceFingerprint,
    })
    const alert = await store.updateAlertStatus(id, 'REVIEWED')
    logSecurity('device_block_removed', {
      ip: existing.ipAddress,
      fingerprint: existing.deviceFingerprint,
      alertId: id,
      username: existing.username,
      reviewer: req.user?.username,
    })
    publish('security')
    publish('alerts')
    return res.status(200).json({ alert })
  })

  return router
}

module.exports = {
  createSecurityAlertsRouter,
}
