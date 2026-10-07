const { createAdminNotification } = require('./adminNotifications')
const { userHasPermission } = require('../constants/permissions')
const { formatDate, todayIso, ACTIVE_STATUSES, TIME_SLOTS, ensureReservationsSchema, addDaysIso } = require('./reservations')
const { formatTimeRange12Hour } = require('../config/siteData')

const REMINDER_INTERVAL_MS = Number.parseInt(process.env.RESERVATION_REMINDER_INTERVAL_MS, 10) || 10 * 60 * 1000

let reminderRun = null
let reminderTimer = null

function slotLabel(timeSlot) {
  const normalized = String(timeSlot || '').slice(0, 5)
  const found = TIME_SLOTS.find((slot) => slot.value === normalized)
  if (found) return found.label
  if (!/^\d{2}:\d{2}$/.test(normalized)) return normalized
  const [hour, minute] = normalized.split(':').map(Number)
  const end = new Date(2000, 0, 1, hour, minute)
  end.setMinutes(end.getMinutes() + 120)
  const endValue = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
  return formatTimeRange12Hour(normalized, endValue)
}

async function listReminderRecipients(db) {
  const [rows] = await db.execute('SELECT id, role, permissions FROM users')
  return rows.filter((user) => userHasPermission(user, 'table') || userHasPermission(user, 'reservations'))
}

async function notificationExists(db, { type, reservationId, recipientUserId }) {
  try {
    const [rows] = await db.execute(
      `
      SELECT id FROM admin_notifications
      WHERE recipient_user_id = ?
        AND type = ?
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.reservationId')) AS CHAR) = ?
      LIMIT 1
      `,
      [recipientUserId, type, String(reservationId)],
    )
    return rows.length > 0
  } catch {
    const [rows] = await db.execute(
      `
      SELECT id, meta FROM admin_notifications
      WHERE recipient_user_id = ? AND type = ?
      ORDER BY id DESC
      LIMIT 50
      `,
      [recipientUserId, type],
    )
    return rows.some((row) => {
      let meta = row.meta
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta)
        } catch {
          meta = {}
        }
      }
      return String(meta?.reservationId) === String(reservationId)
    })
  }
}

async function notifyRecipients(db, recipients, { type, title, message, meta }) {
  let count = 0
  for (const recipient of recipients) {
    const alreadySent = await notificationExists(db, {
      type,
      reservationId: meta.reservationId,
      recipientUserId: recipient.id,
    })
    if (alreadySent) continue
    await createAdminNotification(db, {
      recipientUserId: recipient.id,
      type,
      title,
      message,
      meta,
    })
    count += 1
  }
  return count
}

/** Clear legacy 3-day alerts — reminders are only sent 1 day ahead now. */
async function dismissLegacyThreeDayAlerts(db) {
  try {
    await db.execute(
      `UPDATE admin_notifications SET is_read = 1 WHERE type = 'reservation_3d' AND is_read = 0`,
    )
  } catch {
    // Schema may not exist yet on first boot; ignore.
  }
}

async function dismissInactiveReservationAlerts(db, today) {
  try {
    await db.execute(
      `
      UPDATE admin_notifications n
      SET n.is_read = 1
      WHERE n.is_read = 0
        AND n.type LIKE 'reservation_%'
        AND NOT EXISTS (
          SELECT 1 FROM reservations r
          WHERE r.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(n.meta, '$.reservationId')) AS UNSIGNED)
            AND r.status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
            AND r.reservation_date >= ?
        )
      `,
      [...ACTIVE_STATUSES, today],
    )
  } catch {}
}

async function notifyReservationCreated(db, reservation) {
  try {
    const recipients = await listReminderRecipients(db)
    if (!recipients.length || !reservation) return

    const date = formatDate(reservation.reservation_date)
    const tableName = reservation.table_name || `Table ${reservation.table_id}`
    const isPending = reservation.status === 'Pending'
    const type = isPending ? 'reservation_pending' : 'reservation_new'
    const title = isPending ? 'Pending reservation' : 'New reservation booking'
    const message = `New booking: ${reservation.customer_name} at ${tableName} on ${date} (${slotLabel(reservation.time_slot)}).`

    await notifyRecipients(db, recipients, {
      type,
      title,
      message,
      meta: {
        reservationId: reservation.id,
        customerName: reservation.customer_name,
        phone: reservation.phone,
        tableId: reservation.table_id,
        tableName,
        guestCount: reservation.guest_count,
        reservationDate: date,
        timeSlot: String(reservation.time_slot).slice(0, 5),
        status: reservation.status,
      },
    })
  } catch (error) {
    console.warn('⚠️ Failed to send new reservation notification:', error.message)
  }
}

async function runReminderPass(db) {
  await ensureReservationsSchema(db)

  const recipients = await listReminderRecipients(db)
  if (!recipients.length) return { created: 0 }

  const today = todayIso()
  const tomorrow = addDaysIso(today, 1)
  let created = 0

  await dismissInactiveReservationAlerts(db, today)

  // 1. Pending reservations needing confirmation (today or upcoming)
  const [pendingRows] = await db.execute(
    `
    SELECT r.id, r.customer_name, r.phone, DATE_FORMAT(r.reservation_date, '%Y-%m-%d') AS reservation_date, r.time_slot, r.guest_count,
           r.table_id, t.table_name
    FROM reservations r
    JOIN tables t ON t.id = r.table_id
    WHERE r.reservation_date >= ?
      AND r.status = 'Pending'
    ORDER BY r.reservation_date ASC
    LIMIT 20
    `,
    [today],
  )

  for (const row of pendingRows) {
    const date = formatDate(row.reservation_date)
    const tableName = row.table_name || `Table ${row.table_id}`
    const sent = await notifyRecipients(db, recipients, {
      type: 'reservation_pending',
      title: 'Pending reservation',
      message: `Pending booking: ${row.customer_name} at ${tableName} on ${date} (${slotLabel(row.time_slot)}).`,
      meta: {
        reservationId: row.id,
        customerName: row.customer_name,
        phone: row.phone,
        tableId: row.table_id,
        tableName,
        guestCount: row.guest_count,
        reservationDate: date,
        timeSlot: String(row.time_slot).slice(0, 5),
        status: 'Pending',
      },
    })
    created += sent
  }

  // 2. Reservations for TODAY
  const [todayRows] = await db.execute(
    `
    SELECT r.id, r.customer_name, r.phone, DATE_FORMAT(r.reservation_date, '%Y-%m-%d') AS reservation_date, r.time_slot, r.guest_count,
           r.table_id, t.table_name, r.status
    FROM reservations r
    JOIN tables t ON t.id = r.table_id
    WHERE r.reservation_date = ?
      AND r.status IN ('Confirmed', 'Paid', 'Reserved')
      AND r.checked_in_at IS NULL
    `,
    [today],
  )

  for (const row of todayRows) {
    const date = formatDate(row.reservation_date)
    const tableName = row.table_name || `Table ${row.table_id}`
    const sent = await notifyRecipients(db, recipients, {
      type: 'reservation_today',
      title: 'Reservation today',
      message: `Today: reservation for ${row.customer_name} at ${tableName} (${slotLabel(row.time_slot)}) [${row.status}].`,
      meta: {
        reservationId: row.id,
        customerName: row.customer_name,
        phone: row.phone,
        tableId: row.table_id,
        tableName,
        guestCount: row.guest_count,
        reservationDate: date,
        timeSlot: String(row.time_slot).slice(0, 5),
        status: row.status,
      },
    })
    created += sent
  }

  // 3. Reservations for TOMORROW (1 day reminder)
  const [oneDayRows] = await db.execute(
    `
    SELECT r.id, r.customer_name, r.phone, DATE_FORMAT(r.reservation_date, '%Y-%m-%d') AS reservation_date, r.time_slot, r.guest_count,
           r.table_id, t.table_name, r.status
    FROM reservations r
    JOIN tables t ON t.id = r.table_id
    WHERE r.reservation_date = ?
      AND r.status IN ('Pending', 'Confirmed', 'Paid', 'Reserved')
      AND r.reminder_1d_sent = 0
    `,
    [tomorrow],
  )

  for (const row of oneDayRows) {
    const date = formatDate(row.reservation_date)
    const tableName = row.table_name || `Table ${row.table_id}`
    const sent = await notifyRecipients(db, recipients, {
      type: 'reservation_1d',
      title: 'Reservation tomorrow',
      message: `Tomorrow: reservation for ${row.customer_name} at ${tableName} on ${date} (${slotLabel(row.time_slot)}) [${row.status}].`,
      meta: {
        reservationId: row.id,
        customerName: row.customer_name,
        phone: row.phone,
        tableId: row.table_id,
        tableName,
        guestCount: row.guest_count,
        reservationDate: date,
        timeSlot: String(row.time_slot).slice(0, 5),
        status: row.status,
      },
    })
    await db.execute('UPDATE reservations SET reminder_1d_sent = 1 WHERE id = ? AND reminder_1d_sent = 0', [row.id])
    created += sent
  }

  // 4. Upcoming advance reservations (2 days or more in advance)
  const [upcomingRows] = await db.execute(
    `
    SELECT r.id, r.customer_name, r.phone, DATE_FORMAT(r.reservation_date, '%Y-%m-%d') AS reservation_date, r.time_slot, r.guest_count,
           r.table_id, t.table_name, r.status
    FROM reservations r
    JOIN tables t ON t.id = r.table_id
    WHERE r.reservation_date > ?
      AND r.status IN ('Confirmed', 'Paid', 'Reserved')
    ORDER BY r.reservation_date ASC
    LIMIT 30
    `,
    [tomorrow],
  )

  for (const row of upcomingRows) {
    const date = formatDate(row.reservation_date)
    const tableName = row.table_name || `Table ${row.table_id}`
    const daysDiff = Math.max(2, Math.round((new Date(date).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)))
    const timeFrame = daysDiff <= 7 ? `in ${daysDiff} days` : `on ${date}`
    const sent = await notifyRecipients(db, recipients, {
      type: 'reservation_upcoming',
      title: `Upcoming reservation (${timeFrame})`,
      message: `Upcoming booking for ${row.customer_name} at ${tableName} on ${date} (${slotLabel(row.time_slot)}) [${row.status}].`,
      meta: {
        reservationId: row.id,
        customerName: row.customer_name,
        phone: row.phone,
        tableId: row.table_id,
        tableName,
        guestCount: row.guest_count,
        reservationDate: date,
        timeSlot: String(row.time_slot).slice(0, 5),
        status: row.status,
        daysAhead: daysDiff,
      },
    })
    created += sent
  }

  return { created }
}

async function processReservationReminders(db) {
  if (reminderRun) return reminderRun
  reminderRun = runReminderPass(db).finally(() => {
    reminderRun = null
  })
  return reminderRun
}

function startReservationReminderJob(db) {
  if (reminderTimer) return reminderTimer

  const run = () => {
    processReservationReminders(db).catch((error) => {
      console.warn('⚠️ Reservation reminder job failed:', error.message)
    })
  }

  run()
  reminderTimer = setInterval(run, REMINDER_INTERVAL_MS)
  if (typeof reminderTimer.unref === 'function') reminderTimer.unref()
  return reminderTimer
}

module.exports = {
  processReservationReminders,
  startReservationReminderJob,
  notifyReservationCreated,
  REMINDER_INTERVAL_MS,
}
