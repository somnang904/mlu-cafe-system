const { registerSchemaReset } = require('./schemaReset')
let schemaReadyPromise = null
registerSchemaReset(() => {
  schemaReadyPromise = null
})

async function ensureAdminNotificationsSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          recipient_user_id INT NOT NULL,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          meta JSON NULL,
          is_read TINYINT(1) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_admin_notif_recipient (recipient_user_id, is_read, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

async function createAdminNotification(db, {
  recipientUserId,
  type,
  title,
  message,
  meta = null,
}) {
  await ensureAdminNotificationsSchema(db)
  const [result] = await db.execute(
    `INSERT INTO admin_notifications (recipient_user_id, type, title, message, meta)
     VALUES (?, ?, ?, ?, ?)`,
    [
      recipientUserId,
      String(type).slice(0, 50),
      String(title).slice(0, 255),
      String(message).slice(0, 4000),
      meta ? JSON.stringify(meta) : null,
    ],
  )
  return result.insertId
}

function parseMeta(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function toAlert(row) {
  const meta = parseMeta(row.meta)
  const type = String(row.type || '')

  if (type.startsWith('reservation_')) {
    const isPending = type === 'reservation_pending'
    return {
      id: `reservation-${row.id}`,
      notificationId: row.id,
      category: 'reservation',
      severity: 'warning',
      title: row.title,
      message: row.message,
      timestamp: row.created_at,
      action: {
        label: 'Open Reservations',
        navigateTo: 'reservations',
      },
      meta: {
        reservationId: meta.reservationId ?? null,
        customerName: meta.customerName || '',
        phone: meta.phone || '',
        tableId: meta.tableId ?? null,
        tableName: meta.tableName || '',
        guestCount: meta.guestCount ?? null,
        reservationDate: meta.reservationDate || null,
        timeSlot: meta.timeSlot || null,
        reminderKind: type === 'reservation_1d' ? '1d' : '3d',
        isRead: Boolean(row.is_read),
      },
    }
  }

  if (type === 'expense_logged') {
    return {
      id: `expense-${row.id}`,
      notificationId: row.id,
      category: 'expense',
      severity: 'warning',
      title: row.title,
      message: row.message,
      timestamp: row.created_at,
      action: {
        label: 'Open Expenses',
        navigateTo: 'reports',
      },
      meta: {
        expenseId: meta.expenseId ?? null,
        amount: meta.amount ?? null,
        category: meta.category || '',
        description: meta.description || '',
        expenseDate: meta.expenseDate || null,
        actorName: meta.actorName || '',
        actorUsername: meta.actorUsername || '',
        actorRole: meta.actorRole || '',
        actorUserId: meta.actorUserId ?? null,
        isRead: Boolean(row.is_read),
      },
    }
  }

  const username = meta.username || 'staff'
  const displayName = meta.displayName || username
  const role = meta.role || 'Staff'
  const email = meta.email || null

  return {
    id: `password-reset-${row.id}`,
    notificationId: row.id,
    category: 'password_reset',
    severity: 'critical',
    title: row.title,
    message: row.message,
    timestamp: row.created_at,
    action: {
      label: 'Open Users',
      navigateTo: 'users',
    },
    meta: {
      username,
      displayName,
      role,
      email,
      requesterUserId: meta.requesterUserId ?? null,
      isRead: Boolean(row.is_read),
    },
  }
}

async function listActiveAdminRecipients(db) {
  const [rows] = await db.execute(
    `SELECT id FROM users WHERE LOWER(role) = 'admin' AND COALESCE(is_active, 1) = 1`,
  )
  return rows
}

/**
 * Notify every active admin when staff/cashier takes money from the till.
 * Caller should skip when the actor is already an admin.
 */
async function notifyAdminsOfExpense(db, { expense, actor }) {
  if (!expense) return []
  const recipients = await listActiveAdminRecipients(db)
  if (!recipients.length) return []

  const amount = Number(expense.amount) || 0
  const amountLabel = `$${amount.toFixed(2)}`
  const actorName = actor?.display_name || actor?.username || 'Staff'
  const actorRole = actor?.role || 'Staff'
  const category = expense.category || 'Others'
  const description = String(expense.description || '').trim()
  const purpose = description || category
  const title = 'Money taken from till'
  const message = `${actorName} (${actorRole}) took ${amountLabel} — ${purpose}.`

  const meta = {
    expenseId: expense.id ?? null,
    amount,
    category,
    description,
    expenseDate: expense.expense_date || null,
    actorName,
    actorUsername: actor?.username || '',
    actorRole,
    actorUserId: actor?.id ?? null,
  }

  const ids = []
  for (const recipient of recipients) {
    // Don't notify the same person who logged it (edge case: admin role mis-check).
    if (actor?.id && Number(recipient.id) === Number(actor.id)) continue
    const id = await createAdminNotification(db, {
      recipientUserId: recipient.id,
      type: 'expense_logged',
      title,
      message,
      meta,
    })
    ids.push(id)
  }
  return ids
}

async function listUnreadUserAlerts(db, recipientUserId) {
  await ensureAdminNotificationsSchema(db)
  const [rows] = await db.execute(
    `SELECT id, recipient_user_id, type, title, message, meta, is_read, created_at
     FROM admin_notifications
     WHERE recipient_user_id = ?
       AND is_read = 0
       AND type <> 'reservation_3d'
     ORDER BY created_at DESC
     LIMIT 50`,
    [recipientUserId],
  )
  return rows.map(toAlert)
}

async function listUnreadPasswordResetAlerts(db, recipientUserId) {
  const alerts = await listUnreadUserAlerts(db, recipientUserId)
  return alerts.filter((alert) => alert.category === 'password_reset')
}

async function markNotificationRead(db, { notificationId, recipientUserId }) {
  await ensureAdminNotificationsSchema(db)
  const [result] = await db.execute(
    `UPDATE admin_notifications
     SET is_read = 1
     WHERE id = ? AND recipient_user_id = ?`,
    [notificationId, recipientUserId],
  )
  return result.affectedRows > 0
}

async function dismissReservationAlerts(db, reservationId) {
  await ensureAdminNotificationsSchema(db)
  const id = String(reservationId)
  try {
    await db.execute(
      `
      UPDATE admin_notifications
      SET is_read = 1
      WHERE is_read = 0
        AND type IN ('reservation_3d', 'reservation_1d')
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.reservationId')) AS CHAR) = ?
      `,
      [id],
    )
  } catch {
    const [rows] = await db.execute(
      `
      SELECT id, meta FROM admin_notifications
      WHERE is_read = 0 AND type IN ('reservation_3d', 'reservation_1d')
      `,
    )
    const ids = rows
      .filter((row) => String(parseMeta(row.meta)?.reservationId) === id)
      .map((row) => row.id)
    if (!ids.length) return
    await db.execute(
      `UPDATE admin_notifications SET is_read = 1 WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    )
  }
}

module.exports = {
  ensureAdminNotificationsSchema,
  createAdminNotification,
  listUnreadUserAlerts,
  listUnreadPasswordResetAlerts,
  markNotificationRead,
  dismissReservationAlerts,
  notifyAdminsOfExpense,
  listActiveAdminRecipients,
}
