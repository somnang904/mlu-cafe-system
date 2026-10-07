const { registerSchemaReset } = require('./schemaReset');
let schemaReadyPromise = null;
registerSchemaReset(() => {
  schemaReadyPromise = null;
});

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
  );
  return rows.length > 0;
}

async function ensureInventorySchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const hasStockStatus = await columnExists(db, 'inventory', 'stock_status');
      if (!hasStockStatus) {
        await db.execute(
          "ALTER TABLE inventory ADD COLUMN stock_status VARCHAR(32) NOT NULL DEFAULT 'IN_STOCK'",
        );
      }

      const hasUnitCost = await columnExists(db, 'inventory', 'unit_cost');
      if (!hasUnitCost) {
        await db.execute(
          'ALTER TABLE inventory ADD COLUMN unit_cost DECIMAL(12, 4) NOT NULL DEFAULT 0',
        );
      }

      const hasArchivedAt = await columnExists(db, 'inventory', 'archived_at');
      if (!hasArchivedAt) {
        await db.execute('ALTER TABLE inventory ADD COLUMN archived_at DATETIME NULL');
      }

      const hasPackSize = await columnExists(db, 'inventory', 'pack_size');
      if (!hasPackSize) {
        await db.execute('ALTER TABLE inventory ADD COLUMN pack_size INT NULL');
      }

      const hasIsIngredient = await columnExists(db, 'inventory', 'is_ingredient');
      if (!hasIsIngredient) {
        await db.execute('ALTER TABLE inventory ADD COLUMN is_ingredient TINYINT(1) NOT NULL DEFAULT 0');
        await db.execute(
          "UPDATE inventory SET is_ingredient = 1 WHERE archived_at IS NOT NULL AND category <> 'Menu'",
        );
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}

function resolveStockStatus(stock, lowThreshold, criticalThreshold) {
  const qty = Number(stock);
  if (qty <= 0) return 'OUT_OF_STOCK';
  if (criticalThreshold != null && qty <= Number(criticalThreshold)) return 'LOW_STOCK';
  if (lowThreshold != null && lowThreshold > 0 && qty <= Number(lowThreshold)) return 'LOW_STOCK';
  return 'IN_STOCK';
}

module.exports = {
  ensureInventorySchema,
  resolveStockStatus,
};
