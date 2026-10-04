const { TIME_SLOTS, getTimeSlotsForDate, isMonday, formatTimeRange12Hour } = require('../config/siteData')
const { dismissReservationAlerts } = require('./adminNotifications')

const ACTIVE_STATUSES = ['Pending', 'Confirmed', 'Paid', 'Reserved']
const SEATED_STATUS = 'Seated'
const HOLD_STATUSES = [...ACTIVE_STATUSES, SEATED_STATUS]
const ALL_STATUSES = [...HOLD_STATUSES, 'Completed', 'Canceled']
const CHECK_IN_STATUSES = [...ACTIVE_STATUSES]

const FLOOR_TABLES = [
  { id: 1, table_name: 'Table 1', section: 'standard', capacity: 4 },
  { id: 2, table_name: 'Table 2', section: 'standard', capacity: 4 },
  { id: 3, table_name: 'Table 3', section: 'standard', capacity: 4 },
  { id: 4, table_name: 'Table 4', section: 'standard', capacity: 4 },
  { id: 5, table_name: 'Table 5', section: 'standard', capacity: 4 },
  { id: 6, table_name: 'Table 6', section: 'standard', capacity: 4 },
  { id: 7, table_name: 'Table 7', section: 'standard', capacity: 4 },
  { id: 8, table_name: 'Table 8', section: 'standard', capacity: 4 },
  { id: 9, table_name: 'VIP Room 1', section: 'vip', capacity: 12 },
  { id: 10, table_name: 'VIP Room 2', section: 'vip', capacity: 12 },
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

let schemaReadyPromise = null

async function columnExists(db, table, column) {
  const [rows] = await db.execute(
    `
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
    `,
    [table, column],
  )
  return rows.length > 0
}

async function ensureColumn(db, table, column, definition) {
  if (await columnExists(db, table, column)) return
  try {
    await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`)
  } catch (error) {
    const withoutAfter = String(definition).replace(/\s+AFTER\s+\S+$/i, '')
    if (withoutAfter === definition) throw error
    await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${withoutAfter}`)
  }
}

async function ensureFloorTables(db) {
  try {
    await db.execute('ALTER TABLE `tables` MODIFY table_name VARCHAR(60) NOT NULL')
  } catch {}
  try {
    await db.execute("ALTER TABLE `tables` MODIFY COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'Empty'")
  } catch {}
  await ensureColumn(db, 'tables', 'section', "VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER table_name")
  await ensureColumn(db, 'tables', 'capacity', 'INT NOT NULL DEFAULT 4 AFTER section')
  // Set while a table's guests are merged onto another table; the table is hidden from the floor.
  await ensureColumn(db, 'tables', 'merged_into', 'INT NULL DEFAULT NULL')

  for (const table of FLOOR_TABLES) {
    await db.execute(
      `
      INSERT INTO tables (id, table_name, section, capacity, status)
      VALUES (?, ?, ?, ?, 'Empty')
      ON DUPLICATE KEY UPDATE
        table_name = VALUES(table_name),
        section = VALUES(section),
        capacity = VALUES(capacity)
      `,
      [table.id, table.table_name, table.section, table.capacity],
    )
  }
}

async function ensureReservationsSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await ensureFloorTables(db)
      await db.execute(`
        CREATE TABLE IF NOT EXISTS reservations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_name VARCHAR(160) NOT NULL,
          phone VARCHAR(40) NOT NULL,
          reservation_date DATE NOT NULL,
          time_slot VARCHAR(8) NOT NULL,
          duration_minutes INT NOT NULL DEFAULT 120,
          table_id INT NOT NULL,
          guest_count INT NOT NULL DEFAULT 2,
          status VARCHAR(20) NOT NULL DEFAULT 'Confirmed',
          checked_in_at DATETIME NULL,
          notes TEXT NULL,
          reminder_3d_sent TINYINT(1) NOT NULL DEFAULT 0,
          reminder_1d_sent TINYINT(1) NOT NULL DEFAULT 0,
          created_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_reservations_date (reservation_date, status),
          INDEX idx_reservations_table_slot (table_id, reservation_date, time_slot)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      await ensureColumn(db, 'reservations', 'duration_minutes', 'INT NOT NULL DEFAULT 120 AFTER time_slot')
      await ensureColumn(db, 'reservations', 'notes', 'TEXT NULL AFTER status')
      await ensureColumn(db, 'reservations', 'checked_in_at', 'DATETIME NULL AFTER status')
      await ensureColumn(db, 'reservations', 'reminder_3d_sent', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER notes')
      await ensureColumn(db, 'reservations', 'reminder_1d_sent', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER reminder_3d_sent')
      await ensureColumn(db, 'reservations', 'created_by', 'INT NULL AFTER reminder_1d_sent')
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

function formatDate(value) {
  if (!value) return null
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
    return match ? match[1] : null
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return null
}

function firstQueryValue(value) {
  if (Array.isArray(value)) return value[0]
  return value
}

function addDaysIso(isoDate, days) {
  const base = formatDate(isoDate)
  if (!base || !DATE_RE.test(base)) return null
  const [year, month, day] = base.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + Number(days))
  return formatDate(date)
}

function formatTimeSlot(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (TIME_RE.test(raw)) return raw
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return raw.slice(0, 5)
  return `${String(Number.parseInt(match[1], 10)).padStart(2, '0')}:${match[2]}`
}

function addMinutesHHmm(hhmm, minutes) {
  const [hour, minute] = formatTimeSlot(hhmm).split(':').map(Number)
  const date = new Date(2000, 0, 1, hour, minute)
  date.setMinutes(date.getMinutes() + Number(minutes || 0))
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function slotMeta(timeSlot) {
  const normalized = formatTimeSlot(timeSlot)
  const found = TIME_SLOTS.find((slot) => slot.value === normalized)
  if (found) return found
  const durationMinutes = 120
  return {
    value: normalized,
    label: formatTimeRange12Hour(normalized, addMinutesHHmm(normalized, durationMinutes)),
    durationMinutes,
  }
}

function serializeReservation(row) {
  const timeSlot = formatTimeSlot(row.time_slot)
  const meta = slotMeta(timeSlot)
  const durationMinutes = Number(row.duration_minutes) || meta.durationMinutes
  return {
    id: row.id,
    customer_name: row.customer_name,
    phone: row.phone,
    reservation_date: formatDate(row.reservation_date),
    time_slot: timeSlot,
    time_slot_label: formatTimeRange12Hour(timeSlot, addMinutesHHmm(timeSlot, durationMinutes)),
    duration_minutes: durationMinutes,
    table_id: row.table_id,
    table_name: row.table_name || `Table ${row.table_id}`,
    table_section: row.table_section || 'standard',
    guest_count: Number(row.guest_count) || 1,
    status: row.status,
    checked_in_at: row.checked_in_at || null,
    notes: row.notes || '',
    reminder_3d_sent: Boolean(row.reminder_3d_sent),
    reminder_1d_sent: Boolean(row.reminder_1d_sent),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function serializeFloorTable(row) {
  return {
    id: row.id,
    name: row.table_name,
    section: row.section || (String(row.table_name).startsWith('VIP') ? 'vip' : 'standard'),
    capacity: Number(row.capacity) || 4,
    status: row.status || 'Empty',
    mergedInto: row.merged_into != null ? Number(row.merged_into) : null,
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function parsePayload(payload = {}) {
  const customerName = String(payload.customer_name || '').trim()
  const phone = String(payload.phone || '').trim()
  const reservationDate = formatDate(payload.reservation_date)
  const timeSlot = formatTimeSlot(payload.time_slot)
  const tableId = Number.parseInt(payload.table_id, 10)
  const guestCount = Number.parseInt(payload.guest_count, 10)
  const status = String(payload.status || 'Confirmed').trim()
  const notes = String(payload.notes || '').trim()

  if (!customerName) throw httpError(400, 'Customer name is required')
  if (!phone || phone.replace(/\D/g, '').length < 6) {
    throw httpError(400, 'A valid contact phone number is required')
  }
  if (!DATE_RE.test(reservationDate || '')) {
    throw httpError(400, 'Reservation date must be YYYY-MM-DD')
  }
  if (!TIME_RE.test(timeSlot)) {
    throw httpError(400, 'A valid time slot is required')
  }
  if (!Number.isInteger(tableId) || tableId <= 0) {
    throw httpError(400, 'An assigned table is required')
  }
  if (!Number.isInteger(guestCount) || guestCount < 1) {
    throw httpError(400, 'Guest count must be at least 1')
  }
  if (!ALL_STATUSES.includes(status)) {
    throw httpError(400, `Status must be one of: ${ALL_STATUSES.join(', ')}`)
  }

  const isActive = ACTIVE_STATUSES.includes(status)
  if (isMonday(reservationDate) && isActive) {
    throw httpError(400, 'The cafe is closed on Mondays. Please choose another date.')
  }

  const bookable = isMonday(reservationDate) ? [] : getTimeSlotsForDate(reservationDate)
  const matchedSlot = bookable.find((slot) => slot.value === timeSlot)
  if (isActive && !matchedSlot) {
    throw httpError(400, 'That time slot is outside operating hours for the selected date')
  }

  const parsedDuration = Number.parseInt(payload.duration_minutes, 10)
  const durationMinutes =
    (Number.isInteger(parsedDuration) && parsedDuration > 0 ? parsedDuration : null) ||
    matchedSlot?.durationMinutes ||
    slotMeta(timeSlot).durationMinutes

  return {
    customerName,
    phone,
    reservationDate,
    timeSlot,
    tableId,
    guestCount,
    status,
    notes,
    durationMinutes,
  }
}

const SELECT_SQL = `
  SELECT
    r.*,
    t.table_name,
    t.section AS table_section,
    t.capacity
  FROM reservations r
  JOIN tables t ON t.id = r.table_id
`

async function listFloorTables(db) {
  await ensureReservationsSchema(db)
  const [rows] = await db.execute(
    'SELECT id, table_name, section, capacity, status, merged_into FROM tables ORDER BY CASE WHEN LOWER(section) = "vip" THEN 1 ELSE 0 END, id ASC',
  )
  return rows.map(serializeFloorTable)
}

async function findTable(db, tableId) {
  const [rows] = await db.execute(
    'SELECT id, table_name, section, capacity FROM tables WHERE id = ? LIMIT 1',
    [tableId],
  )
  return rows[0] || null
}

async function findConflict(db, { tableId, reservationDate, timeSlot, excludeId = null }) {
  const params = [tableId, reservationDate, timeSlot, ...HOLD_STATUSES]
  let sql = `
    SELECT id FROM reservations
    WHERE table_id = ?
      AND reservation_date = ?
      AND time_slot = ?
      AND status IN (${HOLD_STATUSES.map(() => '?').join(', ')})
  `
  if (excludeId) {
    sql += ' AND id <> ?'
    params.push(excludeId)
  }
  sql += ' LIMIT 1'
  const [rows] = await db.execute(sql, params)
  return rows[0] || null
}

async function listReservations(db, query = {}) {
  await ensureReservationsSchema(db)
  const clauses = []
  const params = []

  const dateParam = firstQueryValue(query.date)
  const fromParam = firstQueryValue(query.from)
  const toParam = firstQueryValue(query.to)
  const statusParam = firstQueryValue(query.status)

  if (dateParam && DATE_RE.test(dateParam)) {
    clauses.push('r.reservation_date = ?')
    params.push(dateParam)
  } else {
    if (fromParam && DATE_RE.test(fromParam)) {
      clauses.push('r.reservation_date >= ?')
      params.push(fromParam)
    }
    if (toParam && DATE_RE.test(toParam)) {
      clauses.push('r.reservation_date <= ?')
      params.push(toParam)
    }
  }

  if (statusParam && ALL_STATUSES.includes(statusParam)) {
    clauses.push('r.status = ?')
    params.push(statusParam)
  }

  if (query.table_id) {
    const tableId = Number.parseInt(query.table_id, 10)
    if (Number.isInteger(tableId)) {
      clauses.push('r.table_id = ?')
      params.push(tableId)
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await db.execute(
    `${SELECT_SQL} ${where} ORDER BY r.reservation_date ASC, r.time_slot ASC, r.id ASC`,
    params,
  )
  return rows.map(serializeReservation)
}

async function getReservation(db, id) {
  await ensureReservationsSchema(db)
  const reservationId = Number.parseInt(id, 10)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    throw httpError(400, 'Invalid reservation id')
  }
  const [rows] = await db.execute(`${SELECT_SQL} WHERE r.id = ? LIMIT 1`, [reservationId])
  if (!rows.length) throw httpError(404, 'Reservation not found')
  return serializeReservation(rows[0])
}

async function createReservation(db, payload, user) {
  await ensureReservationsSchema(db)
  const data = parsePayload(payload)
  const table = await findTable(db, data.tableId)
  if (!table) throw httpError(400, 'Assigned table was not found')

  if (ACTIVE_STATUSES.includes(data.status)) {
    const conflict = await findConflict(db, {
      tableId: data.tableId,
      reservationDate: data.reservationDate,
      timeSlot: data.timeSlot,
    })
    if (conflict) {
      throw httpError(409, `${table.table_name} is already booked for that date and time slot`)
    }
  }

  const [result] = await db.execute(
    `
    INSERT INTO reservations (
      customer_name, phone, reservation_date, time_slot, duration_minutes,
      table_id, guest_count, status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      data.customerName,
      data.phone,
      data.reservationDate,
      data.timeSlot,
      data.durationMinutes,
      data.tableId,
      data.guestCount,
      data.status,
      data.notes || null,
      user?.id || null,
    ],
  )

  return getReservation(db, result.insertId)
}

async function updateReservation(db, id, payload) {
  await ensureReservationsSchema(db)
  const existing = await getReservation(db, id)
  const data = parsePayload({ ...existing, ...payload, notes: payload.notes ?? existing.notes })
  const table = await findTable(db, data.tableId)
  if (!table) throw httpError(400, 'Assigned table was not found')

  if (ACTIVE_STATUSES.includes(data.status)) {
    const conflict = await findConflict(db, {
      tableId: data.tableId,
      reservationDate: data.reservationDate,
      timeSlot: data.timeSlot,
      excludeId: existing.id,
    })
    if (conflict) {
      throw httpError(409, `${table.table_name} is already booked for that date and time slot`)
    }
  }

  await db.execute(
    `
    UPDATE reservations
    SET customer_name = ?, phone = ?, reservation_date = ?, time_slot = ?,
        duration_minutes = ?, table_id = ?, guest_count = ?, status = ?, notes = ?
    WHERE id = ?
    `,
    [
      data.customerName,
      data.phone,
      data.reservationDate,
      data.timeSlot,
      data.durationMinutes,
      data.tableId,
      data.guestCount,
      data.status,
      data.notes || null,
      existing.id,
    ],
  )

  return getReservation(db, existing.id)
}

async function checkInReservation(db, id) {
  await ensureReservationsSchema(db)
  const existing = await getReservation(db, id)

  if (existing.status === SEATED_STATUS) return existing
  if (!CHECK_IN_STATUSES.includes(existing.status)) {
    throw httpError(400, `Cannot check in a ${String(existing.status).toLowerCase()} reservation`)
  }

  const today = formatDate(new Date())
  if (existing.reservation_date !== today) {
    throw httpError(400, 'Guests can only be checked in on the reservation date')
  }

  await db.execute(
    `
    UPDATE reservations
    SET status = ?, checked_in_at = CURRENT_TIMESTAMP, reminder_3d_sent = 1, reminder_1d_sent = 1
    WHERE id = ?
    `,
    [SEATED_STATUS, existing.id],
  )

  await dismissReservationAlerts(db, existing.id)
  return getReservation(db, existing.id)
}

async function deleteReservation(db, id) {
  await ensureReservationsSchema(db)
  const existing = await getReservation(db, id)
  await db.execute('DELETE FROM reservations WHERE id = ?', [existing.id])
  return existing
}

async function getAvailableTables(db, { date, timeSlot, excludeId = null } = {}) {
  await ensureReservationsSchema(db)
  const reservationDate = formatDate(firstQueryValue(date))
  const slot = formatTimeSlot(firstQueryValue(timeSlot))
  if (!DATE_RE.test(reservationDate || '') || !TIME_RE.test(slot)) {
    throw httpError(400, 'date and time_slot are required')
  }
  if (isMonday(reservationDate)) {
    throw httpError(400, 'The cafe is closed on Mondays. Please choose another date.')
  }

  const tables = await listFloorTables(db)
  const params = [reservationDate, slot, ...HOLD_STATUSES]
  let sql = `
    SELECT table_id FROM reservations
    WHERE reservation_date = ?
      AND time_slot = ?
      AND status IN (${HOLD_STATUSES.map(() => '?').join(', ')})
  `
  const exclude = Number.parseInt(excludeId, 10)
  if (Number.isInteger(exclude) && exclude > 0) {
    sql += ' AND id <> ?'
    params.push(exclude)
  }

  const [busyRows] = await db.execute(sql, params)
  const busyIds = new Set(busyRows.map((row) => row.table_id))

  return {
    date: reservationDate,
    time_slot: slot,
    time_slot_label: slotMeta(slot).label,
    tables: tables.map((table) => ({
      ...table,
      available: !busyIds.has(table.id),
    })),
  }
}

function slotWindow(reservationDate, timeSlot, durationMinutes = 120) {
  const [year, month, day] = reservationDate.split('-').map(Number)
  const [hour, minute] = formatTimeSlot(timeSlot).split(':').map(Number)
  const start = new Date(year, month - 1, day, hour, minute, 0, 0)
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  return { start, end }
}

function isWithinReservedWindow(reservation, now = new Date()) {
  if (!HOLD_STATUSES.includes(reservation.status)) return false
  const today = formatDate(now)
  if (reservation.reservation_date !== today) return false
  const { end } = slotWindow(
    reservation.reservation_date,
    reservation.time_slot,
    reservation.duration_minutes,
  )
  return now < end
}

async function getLiveFloorReservations(db, now = new Date()) {
  await ensureReservationsSchema(db)
  const today = formatDate(now)
  const rows = await listReservations(db, { date: today })
  const byTable = {}

  for (const reservation of rows) {
    if (!isWithinReservedWindow(reservation, now)) continue
    const current = byTable[reservation.table_id]
    const incomingStart = slotWindow(
      reservation.reservation_date,
      reservation.time_slot,
      reservation.duration_minutes,
    ).start
    const currentStart = current
      ? slotWindow(current.reservation_date, current.time_slot, current.duration_minutes || 120).start
      : null
    const incomingIsLive = now >= incomingStart
    const currentIsLive = Boolean(currentStart && now >= currentStart)
    const shouldReplace =
      !current ||
      (incomingIsLive && !currentIsLive) ||
      (incomingIsLive === currentIsLive && incomingStart < currentStart)

    if (shouldReplace) {
      const tableKey = String(reservation.table_id)
      byTable[tableKey] = {
        id: reservation.id,
        customer_name: reservation.customer_name,
        phone: reservation.phone,
        guest_count: reservation.guest_count,
        time_slot: reservation.time_slot,
        time_slot_label: reservation.time_slot_label,
        notes: reservation.notes,
        status: reservation.status,
        checked_in_at: reservation.checked_in_at,
        table_id: reservation.table_id,
        table_name: reservation.table_name,
        reservation_date: reservation.reservation_date,
        duration_minutes: reservation.duration_minutes,
      }
    }
  }

  return {
    date: today,
    tables: byTable,
  }
}

module.exports = {
  ACTIVE_STATUSES,
  HOLD_STATUSES,
  ALL_STATUSES,
  SEATED_STATUS,
  TIME_SLOTS,
  FLOOR_TABLES,
  ensureReservationsSchema,
  ensureFloorTables,
  listFloorTables,
  listReservations,
  getReservation,
  createReservation,
  updateReservation,
  checkInReservation,
  deleteReservation,
  getAvailableTables,
  getLiveFloorReservations,
  formatDate,
  addDaysIso,
}
