const { reconcileOrderStock, withTransaction } = require('./stockLedger')
const { pendingOrderLockName, targetIdSelectSql } = require('./orderTargets')
const { completeSeatedReservationsForTable } = require('./reservations')

const STALE_HOURS = Number.parseInt(process.env.STALE_ORDER_HOURS, 10) || 24
const CLEANUP_INTERVAL_MS = Number.parseInt(process.env.STALE_ORDER_CLEANUP_INTERVAL_MS, 10) || 15 * 60 * 1000

let cleanupTimer = null
let cleanupRun = null

// An order counts as abandoned when nobody has touched it for STALE_HOURS.
async function findStalePendingOrders(db, hours) {
  const [rows] = await db.execute(
    `
    SELECT o.id, o.table_id, ${targetIdSelectSql('o')} AS target_key
    FROM orders o
    WHERE o.status = 'Pending'
      AND GREATEST(o.created_at, COALESCE(o.updated_at, o.created_at)) < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `,
    [hours],
  )
  return rows
}

async function cancelStaleOrder(db, order) {
  return withTransaction(db, async (conn) => {
    // Re-check inside the lock: the order may have been paid or edited since the scan.
    const [rows] = await conn.execute(
      `SELECT id FROM orders WHERE id = ? AND status = 'Pending'
         AND GREATEST(created_at, COALESCE(updated_at, created_at)) < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [order.id, STALE_HOURS],
    )
    if (rows.length === 0) return false

    await reconcileOrderStock(conn, order.id, [], null)
    await conn.execute("UPDATE orders SET status = 'Canceled', updated_at = NOW() WHERE id = ?", [order.id])

    const tableId = order.table_id
    if (tableId) {
      await conn.execute('UPDATE tables SET status = "Empty" WHERE id = ?', [tableId])
      await conn.execute('UPDATE tables SET merged_into = NULL, status = "Empty" WHERE merged_into = ?', [tableId])
      try {
        await completeSeatedReservationsForTable(conn, tableId)
      } catch (err) {
        console.warn('⚠️ Could not complete the seated reservation:', err.message)
      }
    }
    return true
  }, { locks: [pendingOrderLockName({ key: String(order.target_key) })] })
}

// Tables left Occupied/Paid with no open bill and no activity for STALE_HOURS go back to Empty.
async function clearStaleTables(db, hours) {
  const [rows] = await db.execute(
    `
    SELECT t.id
    FROM tables t
    WHERE t.status IN ('Occupied', 'Paid')
      AND NOT EXISTS (SELECT 1 FROM orders p WHERE p.table_id = t.id AND p.status = 'Pending')
      AND EXISTS (SELECT 1 FROM orders h WHERE h.table_id = t.id)
      AND (
        SELECT MAX(GREATEST(h.created_at, COALESCE(h.updated_at, h.created_at)))
        FROM orders h WHERE h.table_id = t.id
      ) < DATE_SUB(NOW(), INTERVAL ? HOUR)
    `,
    [hours],
  )
  let cleared = 0
  for (const { id } of rows) {
    await db.execute('UPDATE tables SET status = "Empty" WHERE id = ?', [id])
    await db.execute('UPDATE tables SET merged_into = NULL, status = "Empty" WHERE merged_into = ?', [id])
    cleared += 1
  }
  return cleared
}

async function runStaleOrderCleanup(db, hours = STALE_HOURS) {
  if (cleanupRun) return cleanupRun
  cleanupRun = (async () => {
    let canceled = 0
    for (const order of await findStalePendingOrders(db, hours)) {
      try {
        if (await cancelStaleOrder(db, order)) canceled += 1
      } catch (err) {
        console.error(`❌ Stale order cleanup failed for order ${order.id}:`, err.message)
      }
    }
    const tablesCleared = await clearStaleTables(db, hours)
    if (canceled > 0 || tablesCleared > 0) {
      console.log(`🧹 Auto-cleared ${canceled} unpaid order(s) and ${tablesCleared} idle table(s) after ${hours}h of inactivity`)
    }
    return { canceled, tablesCleared }
  })().finally(() => {
    cleanupRun = null
  })
  return cleanupRun
}

function startStaleOrderCleanupJob(db) {
  if (cleanupTimer) return cleanupTimer
  const tick = () => runStaleOrderCleanup(db).catch((err) => console.error('❌ Stale order cleanup error:', err.message))
  tick()
  cleanupTimer = setInterval(tick, CLEANUP_INTERVAL_MS)
  cleanupTimer.unref?.()
  return cleanupTimer
}

module.exports = { runStaleOrderCleanup, startStaleOrderCleanupJob, STALE_HOURS }
