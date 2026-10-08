const BEER_NAMES = [
  'Cambodia',
  'Tiger Crystal',
  'Hanuman',
  'Hoegaarden',
  'Jinro',
  'Corona',
  'Hanuman Black',
]

const KULEN_NAME = 'Kulen Water (1.5L)'

const { registerSchemaReset } = require('./schemaReset')
let schemaReadyPromise = null
registerSchemaReset(() => {
  schemaReadyPromise = null
})

async function tableEngine(db, table) {
  const [rows] = await db.execute(
    `SELECT ENGINE FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  )
  return rows[0]?.ENGINE || null
}

// Imports into servers that default to MyISAM (e.g. WAMP's MariaDB) create tables
// without an ENGINE clause as MyISAM, which has no row locks or foreign keys.
async function ensureInnoDb(db, table) {
  const engine = await tableEngine(db, table)
  if (!engine || engine === 'InnoDB') return engine
  await db.execute(`ALTER TABLE \`${table}\` ENGINE=InnoDB`)
  console.log(`   Converted ${table} from ${engine} to InnoDB`)
  return tableEngine(db, table)
}

async function ensureDirectLink(db, name) {
  const [stock] = await db.execute('SELECT id FROM inventory WHERE item_name = ?', [name])
  const [menu] = await db.execute('SELECT id FROM menu_items WHERE name = ?', [name])
  if (stock.length !== 1 || menu.length !== 1) {
    return {
      name,
      linked: false,
      stockCount: stock.length,
      menuCount: menu.length,
    }
  }

  await db.execute(
    `INSERT INTO menu_item_stock_links
      (menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit)
     SELECT ?, '', '', '', ?, 1
     WHERE NOT EXISTS (
       SELECT 1 FROM menu_item_stock_links
       WHERE menu_item_id = ? AND variant = '' AND option_key = ''
         AND option_value = '' AND inventory_id = ?
     )`,
    [menu[0].id, stock[0].id, menu[0].id, stock[0].id],
  )

  return {
    name,
    linked: true,
    menuItemId: menu[0].id,
    inventoryId: stock[0].id,
  }
}

async function ensureKulenWater(db) {
  const [existing] = await db.execute(
    'SELECT id FROM inventory WHERE item_name = ? LIMIT 1',
    [KULEN_NAME],
  )
  if (!existing.length) {
    await db.execute(
      `INSERT INTO inventory (
         item_name, category, section, stock_quantity, max_stock,
         unit_label, unit_singular, critical_threshold, low_threshold,
         is_weight, stock_status, unit_cost
       ) VALUES (?, 'Cold Drinks', 'countable', 12, 24, 'bottles', 'bottle', 5, 10, 0, 'IN_STOCK', 0)`,
      [KULEN_NAME],
    )
  }
  return ensureDirectLink(db, KULEN_NAME)
}

// Fractional cans (e.g. Condensed Milk) need ≥6 decimal places so grams/300 stays exact.
const STOCK_DECIMALS = [
  ['inventory', 'stock_quantity', 'DECIMAL(14,6) NOT NULL DEFAULT 0', 'decimal(14,6)'],
  ['stock_movements', 'change_amount', 'DECIMAL(14,6) NOT NULL', 'decimal(14,6)'],
  ['stock_movements', 'quantity_after', 'DECIMAL(14,6) NOT NULL', 'decimal(14,6)'],
  ['menu_item_stock_links', 'quantity_per_unit', 'DECIMAL(18,6) NOT NULL', 'decimal(18,6)'],
]

async function ensureDecimalScale(db, table, column, definition, expectedType) {
  const [rows] = await db.execute(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  const from = String(rows[0]?.COLUMN_TYPE || '')
  if (!from) return { table, column, changed: false, missing: true }
  if (from.toLowerCase() === expectedType) {
    return { table, column, changed: false, type: from }
  }
  await db.execute(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${definition}`)
  return { table, column, changed: true, from, to: expectedType }
}

async function ensureStockSchema(db) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const required = ['orders', 'order_items', 'inventory', 'menu_items', 'users']
      const engines = {}
      for (const table of required) {
        engines[table] = await ensureInnoDb(db, table)
        if (engines[table] !== 'InnoDB') {
          throw new Error(`${table} is ${engines[table] || 'missing'}, not InnoDB. Stock locks need InnoDB.`)
        }
      }

      await db.execute(`
        CREATE TABLE IF NOT EXISTS menu_item_stock_links (
          id INT NOT NULL AUTO_INCREMENT,
          menu_item_id INT NOT NULL,
          variant VARCHAR(16) NOT NULL DEFAULT '',
          option_key VARCHAR(32) NOT NULL DEFAULT '',
          option_value VARCHAR(64) NOT NULL DEFAULT '',
          inventory_id INT NOT NULL,
          quantity_per_unit DECIMAL(18,6) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_menu_stock_link (menu_item_id, variant, option_key, option_value, inventory_id),
          KEY idx_stock_link_inventory (inventory_id),
          CONSTRAINT fk_stock_link_menu FOREIGN KEY (menu_item_id) REFERENCES menu_items (id) ON DELETE CASCADE,
          CONSTRAINT fk_stock_link_inventory FOREIGN KEY (inventory_id) REFERENCES inventory (id) ON DELETE RESTRICT,
          CONSTRAINT chk_stock_link_qty CHECK (quantity_per_unit > 0)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      await ensureInnoDb(db, 'menu_item_stock_links')

      await db.execute(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INT NOT NULL AUTO_INCREMENT,
          inventory_id INT NOT NULL,
          change_amount DECIMAL(14,6) NOT NULL,
          quantity_after DECIMAL(14,6) NOT NULL,
          reason ENUM('sale','restock','cancel','adjustment','waste') NOT NULL,
          order_id INT NULL,
          note VARCHAR(255) NULL,
          user_id INT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_stock_movements_item (inventory_id, id),
          KEY idx_stock_movements_order (order_id),
          CONSTRAINT fk_stock_movement_item FOREIGN KEY (inventory_id) REFERENCES inventory (id) ON DELETE RESTRICT,
          CONSTRAINT fk_stock_movement_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL,
          CONSTRAINT fk_stock_movement_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)

      const decimals = []
      for (const [table, column, definition, expectedType] of STOCK_DECIMALS) {
        decimals.push(await ensureDecimalScale(db, table, column, definition, expectedType))
      }

      const beers = []
      for (const name of BEER_NAMES) {
        beers.push(await ensureDirectLink(db, name))
      }
      const kulen = await ensureKulenWater(db)
      const report = { engines, decimals, beers, kulen }
      console.log(`   Stock links: ${JSON.stringify(report)}`)
      return report
    })().catch((error) => {
      schemaReadyPromise = null
      throw error
    })
  }

  return schemaReadyPromise
}

module.exports = {
  BEER_NAMES,
  KULEN_NAME,
  ensureInnoDb,
  ensureStockSchema,
}
