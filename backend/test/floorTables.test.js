require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const db = require('../db')
const { env } = require('../src/config/env')
const { listFloorTables, ensureFloorTables } = require('../src/utils/reservations')
const { signSessionToken } = require('../src/utils/sessionSecurity')
const { createUserSession } = require('../src/utils/userSessions')

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: env.port || 5500,
        path: `/api${path}`,
        method,
        agent: false,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Device-Id': 'b'.repeat(64),
          Connection: 'close',
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try { json = JSON.parse(text) } catch { /* ignore */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

describe('Floor Tables Management', () => {
  let adminToken = null
  let testTableId = null
  let createdOrderId = null

  before(async () => {
    await ensureFloorTables(db)
    const [admins] = await db.execute(
      `SELECT id, username, role, display_name, permissions FROM users WHERE LOWER(role)='admin' ORDER BY id LIMIT 1`,
    )
    if (!admins.length) throw new Error('No admin found for test')
    const admin = admins[0]
    const issued = await signSessionToken(db, admin)
    await createUserSession(db, {
      jti: issued.jti,
      userId: admin.id,
      req: { headers: { 'user-agent': 'TestRunner/1.0' }, get: () => 'TestRunner/1.0', ip: '127.0.0.1' },
    })
    adminToken = issued.token
  })

  after(async () => {
    if (createdOrderId) {
      await db.execute('DELETE FROM order_items WHERE order_id = ?', [createdOrderId])
      await db.execute('DELETE FROM orders WHERE id = ?', [createdOrderId])
    }
    if (testTableId) {
      await db.execute('DELETE FROM tables WHERE id = ?', [testTableId])
    }
  })

  it('listFloorTables returns all tables dynamically', async () => {
    const tables = await listFloorTables(db)
    assert.ok(Array.isArray(tables))
    assert.ok(tables.length >= 10)
  })

  it('POST /api/tables creates a new table', async () => {
    const testName = `Test Table ${Date.now()}`
    const res = await request('POST', '/tables', {
      token: adminToken,
      body: { name: testName, section: 'standard', capacity: 6 },
    })
    assert.equal(res.status, 201)
    assert.ok(res.json?.table?.id)
    assert.equal(res.json.table.name, testName)
    assert.equal(res.json.table.capacity, 6)
    testTableId = res.json.table.id

    // Verify it is returned by listFloorTables
    const all = await listFloorTables(db)
    const found = all.find((t) => t.id === testTableId)
    assert.ok(found, 'Newly created table must be returned by listFloorTables')
    assert.equal(found.name, testName)
  })

  it('POST /api/tables rejects duplicate table names', async () => {
    const [existing] = await db.execute('SELECT table_name FROM tables WHERE id = ?', [testTableId])
    const res = await request('POST', '/tables', {
      token: adminToken,
      body: { name: existing[0].table_name, section: 'standard', capacity: 4 },
    })
    assert.equal(res.status, 409)
  })

  it('PUT /api/tables/:id updates table details', async () => {
    const updatedName = `Updated Table ${Date.now()}`
    const res = await request('PUT', `/tables/${testTableId}`, {
      token: adminToken,
      body: { name: updatedName, section: 'vip', capacity: 8 },
    })
    assert.equal(res.status, 200)
    assert.equal(res.json?.table?.name, updatedName)
    assert.equal(res.json?.table?.section, 'vip')
    assert.equal(res.json?.table?.capacity, 8)

    const all = await listFloorTables(db)
    const found = all.find((t) => t.id === testTableId)
    assert.equal(found.name, updatedName)
    assert.equal(found.section, 'vip')
    assert.equal(found.capacity, 8)
  })

  it('POST /api/tables/transfer moves pending order to another table', async () => {
    // Create a pending order on testTableId
    const [orderRes] = await db.execute(
      `INSERT INTO orders (target_id, table_id, source_type, status, total_amount)
       VALUES (?, ?, 'Table', 'Pending', 10.00)`,
      [testTableId, testTableId],
    )
    createdOrderId = orderRes.insertId

    // Insert order items
    await db.execute(
      `INSERT INTO order_items (order_id, quantity, price, subtotal, item_name)
       VALUES (?, 2, 5.00, 10.00, 'Test Coffee')`,
      [createdOrderId],
    )

    // Transfer from testTableId to Table 2 (ID: 2, assumed empty)
    // Make sure table 2 has no pending order first
    await db.execute(
      `UPDATE orders SET status = 'Canceled' WHERE target_id = 2 AND status = 'Pending'`,
    )

    const transferRes = await request('POST', '/tables/transfer', {
      token: adminToken,
      body: { from_table_id: testTableId, to_table_id: 2 },
    })
    assert.equal(transferRes.status, 200)

    // Check order target_id moved to 2
    const [orders] = await db.execute('SELECT target_id, table_id FROM orders WHERE id = ?', [createdOrderId])
    assert.equal(orders[0].target_id, 2)
    assert.equal(orders[0].table_id, 2)

    // Transfer back to testTableId for clear test
    await request('POST', '/tables/transfer', {
      token: adminToken,
      body: { from_table_id: 2, to_table_id: testTableId },
    })
  })

  it('POST /api/tables/:id/clear cancels pending order and resets table status', async () => {
    const clearRes = await request('POST', `/tables/${testTableId}/clear`, {
      token: adminToken,
    })
    assert.equal(clearRes.status, 200)

    // Verify order is canceled
    const [orders] = await db.execute('SELECT status FROM orders WHERE id = ?', [createdOrderId])
    assert.equal(orders[0].status, 'Canceled')

    // Verify table is empty
    const [tbl] = await db.execute('SELECT status FROM tables WHERE id = ?', [testTableId])
    assert.equal(tbl[0].status, 'Empty')
  })

  it('DELETE /api/tables/:id deletes the empty custom table', async () => {
    const delRes = await request('DELETE', `/tables/${testTableId}`, {
      token: adminToken,
    })
    assert.equal(delRes.status, 200)

    const [tbl] = await db.execute('SELECT id FROM tables WHERE id = ?', [testTableId])
    assert.equal(tbl.length, 0)
    testTableId = null
  })
})
