let schemaReadyPromise = null

async function getUpdatedAtColumn(db) {
  const [rows] = await db.execute(
    `
    SELECT COLUMN_TYPE, COLUMN_DEFAULT, EXTRA, IS_NULLABLE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'updated_at'
    LIMIT 1
    `,
  )
  return rows[0] || null
}

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

/**
 * Sale history uses updated_at as the sale timestamp.
 * ON UPDATE CURRENT_TIMESTAMP rewrites every row during unrelated ALTER/UPDATE
 * (for example MODIFY tax), which made a full year of seeded sales look like
 * the current month. Strip that auto-update and restore overwritten dates.
 */
async function ensureOrdersSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const column = await getUpdatedAtColumn(db)
      if (column && String(column.EXTRA || '').toLowerCase().includes('on update')) {
        await db.execute(
          'ALTER TABLE orders MODIFY COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
        )
      }

      // Ensure dual currency and change columns exist
      if (!(await columnExists(db, 'orders', 'received_usd'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN received_usd DECIMAL(10,2) NULL AFTER total_amount')
      }
      if (!(await columnExists(db, 'orders', 'received_khr'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN received_khr DECIMAL(14,2) NULL AFTER received_usd')
      }
      if (!(await columnExists(db, 'orders', 'change_usd'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN change_usd DECIMAL(10,2) NULL AFTER received_khr')
      }
      if (!(await columnExists(db, 'orders', 'change_khr'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN change_khr DECIMAL(14,2) NULL AFTER change_usd')
      }
      if (!(await columnExists(db, 'orders', 'exchange_rate'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN exchange_rate DECIMAL(10,2) NULL AFTER change_khr')
      }

      // Ensure void / refund columns exist
      if (!(await columnExists(db, 'orders', 'void_reason'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN void_reason VARCHAR(255) NULL AFTER exchange_rate')
      }
      if (!(await columnExists(db, 'orders', 'voided_by'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN voided_by INT NULL AFTER void_reason')
      }
      if (!(await columnExists(db, 'orders', 'voided_at'))) {
        await db.execute('ALTER TABLE orders ADD COLUMN voided_at TIMESTAMP NULL AFTER voided_by')
      }

      const [result] = await db.execute(
        `
        UPDATE orders
        SET updated_at = created_at
        WHERE created_at IS NOT NULL
          AND updated_at IS NOT NULL
          AND updated_at > DATE_ADD(created_at, INTERVAL 1 DAY)
        `,
      )

      return Number(result.affectedRows || 0)
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }

  return schemaReadyPromise
}

module.exports = {
  ensureOrdersSchema,
  columnExists,
}
