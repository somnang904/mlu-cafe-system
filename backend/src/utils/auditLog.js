const { registerSchemaReset } = require('./schemaReset')
let schemaReadyPromise = null
registerSchemaReset(() => {
  schemaReadyPromise = null
})

async function ensureAuditSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NULL,
          user_role VARCHAR(50) NULL,
          username VARCHAR(120) NULL,
          action VARCHAR(120) NOT NULL,
          module VARCHAR(120) NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_audit_created (created_at),
          INDEX idx_audit_module (module),
          INDEX idx_audit_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }
  return schemaReadyPromise
}

async function writeAuditLog(db, entry = {}) {
  try {
    await ensureAuditSchema(db)
    const action = String(entry.action || '').trim()
    const moduleName = String(entry.module || '').trim()
    if (!action || !moduleName) return null

    const [result] = await db.execute(
      `
      INSERT INTO audit_logs (user_id, user_role, username, action, module, description)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        entry.userId ?? entry.user_id ?? null,
        entry.userRole ?? entry.user_role ?? null,
        entry.username ?? null,
        action.slice(0, 120),
        moduleName.slice(0, 120),
        entry.description ? String(entry.description).slice(0, 2000) : null,
      ],
    )
    return result.insertId
  } catch (error) {
    console.warn('⚠️ Audit log write skipped:', error.message)
    return null
  }
}

function actorFromRequest(req) {
  const user = req?.user
  if (!user) {
    return { userId: null, userRole: null, username: null }
  }
  return {
    userId: user.id ?? null,
    userRole: user.role ?? null,
    username: user.username || user.display_name || null,
  }
}

async function auditFromRequest(db, req, { action, module, description }) {
  const actor = actorFromRequest(req)
  return writeAuditLog(db, {
    ...actor,
    action,
    module,
    description,
  })
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function mapAuditRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    user_role: row.user_role,
    username: row.username,
    action: row.action,
    module: row.module,
    description: row.description || '',
    created_at: row.created_at,
  }
}

async function listAuditLogs(db, query = {}) {
  await ensureAuditSchema(db)
  const pageSize = 50
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1)
  const offset = (page - 1) * pageSize
  const where = []
  const params = []

  if (isIsoDate(query.from)) {
    where.push('created_at >= ?')
    params.push(`${query.from} 00:00:00`)
  }
  if (isIsoDate(query.to)) {
    where.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)')
    params.push(`${query.to} 00:00:00`)
  }
  const user = String(query.user || '').trim().slice(0, 80)
  if (user) {
    where.push('(username LIKE ? OR CAST(user_id AS CHAR) = ?)')
    params.push(`%${user}%`, user)
  }
  const moduleName = String(query.module || '').trim().slice(0, 120)
  if (moduleName) {
    where.push('module = ?')
    params.push(moduleName)
  }
  const action = String(query.action || '').trim().slice(0, 120)
  if (action) {
    where.push('action = ?')
    params.push(action)
  }
  const search = String(query.q || query.search || '').trim().slice(0, 120)
  if (search) {
    where.push('(description LIKE ? OR username LIKE ? OR action LIKE ? OR module LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
    params,
  )
  const [rows] = await db.execute(
    `
    SELECT id, user_id, user_role, username, action, module, description, created_at
    FROM audit_logs
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}
    `,
    params,
  )
  const [moduleRows] = await db.execute(
    'SELECT DISTINCT module FROM audit_logs ORDER BY module ASC',
  )
  const [actionRows] = await db.execute(
    'SELECT DISTINCT action FROM audit_logs ORDER BY action ASC',
  )

  return {
    logs: rows.map(mapAuditRow),
    page,
    pageSize,
    total: Number(countRows[0]?.total || 0),
    modules: moduleRows.map((row) => row.module).filter(Boolean),
    actions: actionRows.map((row) => row.action).filter(Boolean),
  }
}

module.exports = {
  ensureAuditSchema,
  writeAuditLog,
  auditFromRequest,
  actorFromRequest,
  listAuditLogs,
}
