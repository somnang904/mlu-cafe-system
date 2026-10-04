const TAKEOUT_KEY = 'takeout'

function normalizeIncomingTarget(rawTarget) {
  if (rawTarget == null || rawTarget === '') {
    throw new Error('Order target is required')
  }

  const normalized = String(rawTarget).trim().toLowerCase()

  if (normalized === TAKEOUT_KEY || normalized === 'take out' || normalized === 'take_out') {
    return {
      key: TAKEOUT_KEY,
      targetId: null,
      tableId: null,
      sourceType: 'Take Out',
    }
  }

  const tableNumber = Number.parseInt(normalized, 10)
  if (!Number.isNaN(tableNumber) && tableNumber > 0) {
    return {
      key: String(tableNumber),
      targetId: tableNumber,
      tableId: tableNumber,
      sourceType: 'Table',
    }
  }

  throw new Error(`Invalid order target "${rawTarget}". Use a table number or "takeout".`)
}

function targetIdSelectSql(alias = 'o') {
  return `CASE WHEN ${alias}.source_type = 'Take Out' THEN 'takeout' ELSE CAST(${alias}.target_id AS CHAR) END`
}

function pendingOrderWhereClause(target) {
  if (target.sourceType === 'Take Out') {
    return {
      sql: "source_type = 'Take Out' AND status = 'Pending'",
      params: [],
    }
  }

  return {
    sql: 'target_id = ? AND source_type = ? AND status = ?',
    params: [target.targetId, 'Table', 'Pending'],
  }
}

async function findPendingOrderId(db, target) {
  const { sql, params } = pendingOrderWhereClause(target)
  const [rows] = await db.execute(`SELECT id FROM orders WHERE ${sql} LIMIT 1`, params)
  return rows.length > 0 ? rows[0].id : null
}

async function resolveTableForeignKey(db, tableRef) {
  if (tableRef == null || tableRef === '') return null

  const tableNumber = Number.parseInt(String(tableRef).trim(), 10)
  if (Number.isNaN(tableNumber) || tableNumber <= 0) return null

  const [byId] = await db.execute('SELECT id FROM tables WHERE id = ? LIMIT 1', [tableNumber])
  if (byId.length > 0) return byId[0].id

  const [byName] = await db.execute('SELECT id FROM tables WHERE table_name = ? LIMIT 1', [
    `Table ${tableNumber}`,
  ])
  if (byName.length > 0) return byName[0].id

  return null
}

async function createPendingOrder(db, target, explicitTableId = undefined) {
  let tableId = null

  if (target.sourceType !== 'Take Out') {
    const tableRef = explicitTableId !== undefined ? explicitTableId : target.tableId
    tableId = await resolveTableForeignKey(db, tableRef)
  }

  const [result] = await db.execute(
    `INSERT INTO orders (target_id, table_id, source_type, payment_type, status, total_amount)
     VALUES (?, ?, ?, 'Cash', 'Pending', 0)`,
    [target.targetId, tableId, target.sourceType],
  )
  return result.insertId
}

function logOrderError(context, error, meta = {}) {
  console.error(`❌ ${context}:`, {
    message: error.message,
    code: error.code,
    sqlState: error.sqlState,
    errno: error.errno,
    ...meta,
  })
}

let orderItemsSchemaReadyPromise = null
let orderItemsHasNameColumn = null
let orderItemsHasNotesColumn = null

function formatOrderLineName(baseName, notes) {
  const name = String(baseName || '').trim() || 'Custom item'
  const note = notes != null ? String(notes).trim() : ''
  if (!note) return name
  if (name.includes(`(${note})`) || /\(\s*Sugar:/i.test(name)) return name
  return `${name} (${note})`
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

async function dropForeignKeysOnColumn(db, table, column) {
  const [rows] = await db.execute(
    `
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
      AND REFERENCED_TABLE_NAME IS NOT NULL
    `,
    [table, column],
  )

  for (const row of rows) {
    await db.execute(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``)
  }
}

async function ensureOrderItemsSchema(db) {
  if (!orderItemsSchemaReadyPromise) {
    orderItemsSchemaReadyPromise = (async () => {
      const [nullableRows] = await db.execute(
        `
        SELECT IS_NULLABLE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'order_items'
          AND COLUMN_NAME = 'menu_item_id'
        LIMIT 1
        `,
      )

      const allowsNull = nullableRows[0]?.IS_NULLABLE === 'YES'
      if (!allowsNull) {
        await dropForeignKeysOnColumn(db, 'order_items', 'menu_item_id')
        await db.execute('ALTER TABLE order_items MODIFY menu_item_id INT NULL')
      }

      const hasItemName = await columnExists(db, 'order_items', 'item_name')
      if (!hasItemName) {
        await db.execute(
          'ALTER TABLE order_items ADD COLUMN item_name VARCHAR(255) NULL AFTER menu_item_id',
        )
      }

      const [fkRows] = await db.execute(
        `
        SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
        JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
         AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
          AND kcu.TABLE_NAME = 'order_items'
          AND kcu.COLUMN_NAME = 'menu_item_id'
          AND kcu.REFERENCED_TABLE_NAME = 'menu_items'
        LIMIT 1
        `,
      )

      const needsFk =
        fkRows.length === 0 || String(fkRows[0].DELETE_RULE || '').toUpperCase() !== 'SET NULL'

      if (needsFk) {
        if (fkRows.length > 0) {
          await db.execute(
            `ALTER TABLE order_items DROP FOREIGN KEY \`${fkRows[0].CONSTRAINT_NAME}\``,
          )
        }
        await db.execute(`
          ALTER TABLE order_items
          ADD CONSTRAINT order_items_ibfk_2
          FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
        `)
      }

      orderItemsHasNameColumn = await columnExists(db, 'order_items', 'item_name')

      const hasNotes = await columnExists(db, 'order_items', 'notes')
      if (!hasNotes) {
        await db.execute(
          'ALTER TABLE order_items ADD COLUMN notes VARCHAR(255) NULL AFTER item_name',
        )
      }
      orderItemsHasNotesColumn = true
    })().catch((error) => {
      orderItemsSchemaReadyPromise = null
      throw error
    })
  }

  return orderItemsSchemaReadyPromise
}

function parseMenuItemIdFromItem(item) {
  const parsed = Number.parseInt(item?.menu_item_id ?? item?.id, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseOptionalMoney(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function parseServingFromItem(item) {
  const raw = String(item?.serving || item?.serving_type || '').trim().toLowerCase()
  if (raw === 'hot' || raw === 'iced') return raw
  const notes = String(item?.notes || item?.name || '')
  if (/\bIced\b/i.test(notes)) return 'iced'
  if (/\bHot\b/i.test(notes)) return 'hot'
  return null
}

function lineHttpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function validateOrderLine(item, { isAdmin }) {
  const qty = Number(item?.quantity ?? item?.qty)
  if (!Number.isFinite(qty) || qty <= 0) {
    return 'Each order line needs a valid quantity'
  }

  const menuId = parseMenuItemIdFromItem(item)
  if (menuId) return null

  if (!isAdmin) {
    return 'Only an administrator can add a line that is not on the menu'
  }

  if (parseOptionalMoney(item?.price ?? item?.unitPrice) == null) {
    return 'A custom line needs a valid price'
  }

  return null
}

function savedMenuPrice(row, item) {
  const serving = parseServingFromItem(item)
  if (serving === 'iced') {
    const iced = parseOptionalMoney(row.iced_price)
    if (iced != null) return iced
  }
  if (serving === 'hot') {
    const hot = parseOptionalMoney(row.hot_price)
    if (hot != null) return hot
  }

  const hot = parseOptionalMoney(row.hot_price)
  const iced = parseOptionalMoney(row.iced_price)
  if (hot != null && iced == null) return hot
  if (iced != null && hot == null) return iced
  const base = parseOptionalMoney(row.price)
  if (base != null) return base
  return hot ?? iced ?? null
}

async function resolveLinePrice(db, item) {
  const menuId = parseMenuItemIdFromItem(item)
  if (!menuId) {
    const clientPrice = parseOptionalMoney(item?.price)
    if (clientPrice == null) {
      throw lineHttpError(400, 'A custom line needs a valid price')
    }
    return clientPrice
  }

  const [rows] = await db.execute(
    'SELECT price, hot_price, iced_price FROM menu_items WHERE id = ? LIMIT 1',
    [menuId],
  )
  if (!rows[0]) {
    throw lineHttpError(400, 'Menu item was not found')
  }

  const price = savedMenuPrice(rows[0], item)
  if (price == null) {
    throw lineHttpError(400, 'Menu item has no saved price')
  }
  return price
}

async function resolveMenuItemIdForInsert(db, item) {
  const parsed = parseMenuItemIdFromItem(item)
  if (parsed == null) {
    return null
  }

  const [rows] = await db.execute('SELECT id FROM menu_items WHERE id = ? LIMIT 1', [parsed])
  return rows.length > 0 ? parsed : null
}

/**
 * @param {{ price?: number | null }} [options] A price already decided by the caller
 *   (an admin override, or a line's existing price); otherwise the menu price is used.
 */
async function insertOrderItem(db, orderId, item, { price: presetPrice = null } = {}) {
  const quantity = Number(item.quantity)
  const price = presetPrice != null ? presetPrice : await resolveLinePrice(db, item)
  const subtotal = quantity * price
  const menuItemId = await resolveMenuItemIdForInsert(db, item)
  const itemName =
    item.name != null && String(item.name).trim() !== ''
      ? String(item.name).trim()
      : item.item_name != null && String(item.item_name).trim() !== ''
        ? String(item.item_name).trim()
        : null

  const hasItemName =
    orderItemsHasNameColumn === true ||
    (orderItemsHasNameColumn === null && (await columnExists(db, 'order_items', 'item_name')))

  if (orderItemsHasNameColumn === null) {
    orderItemsHasNameColumn = hasItemName
  }

  const notes =
    item.notes != null && String(item.notes).trim() !== ''
      ? String(item.notes).trim().slice(0, 255)
      : null

  const hasNotes =
    orderItemsHasNotesColumn === true ||
    (orderItemsHasNotesColumn === null && (await columnExists(db, 'order_items', 'notes')))

  if (orderItemsHasNotesColumn === null) {
    orderItemsHasNotesColumn = hasNotes
  }

  let result
  if (hasItemName && hasNotes) {
    ;[result] = await db.execute(
      'INSERT INTO order_items (order_id, menu_item_id, item_name, notes, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [orderId, menuItemId, itemName, notes, quantity, price, subtotal],
    )
  } else if (hasItemName) {
    ;[result] = await db.execute(
      'INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
      [orderId, menuItemId, itemName, quantity, price, subtotal],
    )
  } else {
    ;[result] = await db.execute(
      'INSERT INTO order_items (order_id, menu_item_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
      [orderId, menuItemId, quantity, price, subtotal],
    )
  }

  return {
    orderItemId: result.insertId,
    menuItemId,
  }
}

function lineKey(menuItemId, notes) {
  return `${menuItemId ?? ''}|${String(notes ?? '').trim()}`
}

/**
 * Prices to keep when a bill is rewritten (PUT /orders/items).
 * An admin's typed price wins; otherwise a line that already exists keeps its saved price,
 * so an admin's earlier price edit survives a cashier changing quantities. New lines get null
 * (insertOrderItem then uses the menu price).
 */
async function pickLinePrices(db, orderId, items, { isAdmin }) {
  const existing = new Map()
  if (orderId) {
    const [rows] = await db.execute(
      'SELECT menu_item_id, notes, price FROM order_items WHERE order_id = ?',
      [orderId],
    ).catch(async () => db.execute('SELECT menu_item_id, NULL AS notes, price FROM order_items WHERE order_id = ?', [orderId]))
    for (const row of rows) {
      existing.set(lineKey(row.menu_item_id, row.notes), Number(row.price))
    }
  }

  return items.map((item) => {
    if (isAdmin) {
      const typed = parseOptionalMoney(item?.price ?? item?.unitPrice)
      if (typed != null) return typed
    }
    const menuId = parseMenuItemIdFromItem(item)
    if (!menuId) return null
    const saved = existing.get(lineKey(menuId, item?.notes))
    return Number.isFinite(saved) ? saved : null
  })
}

module.exports = {
  TAKEOUT_KEY,
  pickLinePrices,
  normalizeIncomingTarget,
  targetIdSelectSql,
  pendingOrderWhereClause,
  findPendingOrderId,
  resolveTableForeignKey,
  createPendingOrder,
  insertOrderItem,
  validateOrderLine,
  parseMenuItemIdFromItem,
  ensureOrderItemsSchema,
  formatOrderLineName,
  logOrderError,
}
