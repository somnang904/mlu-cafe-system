const { computeMenuDeleteEligibility, toIso, nameKey } = require('./menuLifecycle')
const { withTransaction } = require('./stockLedger')

let menuItemsSchemaReadyPromise = null

const MENU_CATEGORIES = ['Coffee', 'Tea', 'Cold Drinks', 'Beer', 'Starters', 'Mains', 'Soup', 'Vegetable', 'Dessert']
// ENUM storage order must stay stable. New values are appended only.
const MENU_ENUM_VALUES = ['Coffee', 'Tea', 'Starters', 'Mains', 'Soup', 'Vegetable', 'Dessert', 'Bakery', 'Food', 'Cold Drinks', 'Beer']
const MENU_CATEGORIES_WITH_LEGACY = MENU_ENUM_VALUES
const DRINK_CATEGORIES = new Set(['Coffee', 'Tea'])

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

function normalizeMenuImageUrl(raw) {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed.slice(0, 512)
}

const MAX_MENU_PRICE = 100000
const MAX_IMAGE_URL = 512
const IMAGE_URL_PREFIXES = ['/api/uploads/', '/uploads/', '/menu-images/', 'http://', 'https://']

function parseMenuImageUrl(raw) {
  if (raw == null) return { value: null }
  if (typeof raw !== 'string') return { error: 'Image link is not valid' }
  const trimmed = raw.trim()
  if (!trimmed) return { value: null }
  if (trimmed.length > MAX_IMAGE_URL) return { error: `Image link must be ${MAX_IMAGE_URL} characters or fewer` }
  if (!IMAGE_URL_PREFIXES.some((prefix) => trimmed.toLowerCase().startsWith(prefix)) || /\s/.test(trimmed)) {
    return { error: 'Image link must be an uploaded picture or an http(s) link' }
  }
  return { value: trimmed }
}

function parseOptionalMoney(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function normalizeMenuCategory(raw) {
  const category = String(raw || '').trim()
  if (MENU_CATEGORIES_WITH_LEGACY.includes(category)) return category
  return null
}

// Built-in categories keep their key on menu_items (drink rules, reports and translations use it),
// so renaming one stores a display label and deleting one hides it, in menu_category_settings.
// Categories added from the Menu page live in menu_categories, after the built-in ones.
const MENU_CATEGORY_NAME_MAX = 24
// "All" is the Menu page's show-everything chip, so it can't be a category name.
const RESERVED_CATEGORY_NAMES = ['All']

function cleanCategoryName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ')
}

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

async function listCustomMenuCategories(db) {
  const [rows] = await db.execute('SELECT name FROM menu_categories ORDER BY id')
  return rows.map((row) => row.name)
}

/** Map of built-in key -> { label, hidden } for the built-ins that were renamed or deleted. */
async function loadBuiltInSettings(db) {
  const [rows] = await db.execute('SELECT name, label, hidden FROM menu_category_settings')
  return new Map(rows.map((row) => [row.name, { label: row.label || null, hidden: Boolean(Number(row.hidden)) }]))
}

async function saveBuiltInSetting(db, key, { label = null, hidden = false }) {
  await db.execute(
    'INSERT INTO menu_category_settings (name, label, hidden) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label), hidden = VALUES(hidden)',
    [key, label, hidden ? 1 : 0],
  )
}

/**
 * Category keys (built-in ones in their fixed order, then added ones oldest first) and the
 * display labels of renamed built-ins. Deleted built-ins are left out.
 */
async function getMenuCategories(db) {
  const settings = await loadBuiltInSettings(db)
  const builtIns = MENU_CATEGORIES.filter((key) => !settings.get(key)?.hidden)
  const labels = {}
  for (const key of builtIns) {
    const label = settings.get(key)?.label
    if (label) labels[key] = label
  }
  return { categories: [...builtIns, ...(await listCustomMenuCategories(db))], labels }
}

async function listMenuCategories(db) {
  return (await getMenuCategories(db)).categories
}

/** Like normalizeMenuCategory, but also accepts an added category (returned with its stored spelling). */
async function resolveMenuCategory(db, raw) {
  const builtIn = normalizeMenuCategory(raw)
  if (builtIn) {
    const settings = await loadBuiltInSettings(db)
    return settings.get(builtIn)?.hidden ? null : builtIn
  }
  const name = cleanCategoryName(raw)
  if (!name) return null
  const [rows] = await db.execute('SELECT name FROM menu_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
  return rows[0]?.name ?? null
}

function categoryError(status, message, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function validCategoryName(raw) {
  const name = cleanCategoryName(raw)
  if (!name) throw categoryError(400, 'Enter a category name', 'required')
  if (name.length > MENU_CATEGORY_NAME_MAX) {
    throw categoryError(400, `Use ${MENU_CATEGORY_NAME_MAX} characters or fewer`, 'too_long')
  }
  return name
}

/**
 * Throws if `name` clashes (ignoring case) with another category. Every built-in key stays taken,
 * even a deleted one, because menu items store it. `self` is the category being renamed.
 */
async function assertCategoryNameFree(db, name, self = null) {
  const settings = await loadBuiltInSettings(db)
  const labels = [...settings]
    .filter(([key, setting]) => key !== self && !setting.hidden && setting.label)
    .map(([, setting]) => setting.label)
  const taken = [...MENU_CATEGORIES_WITH_LEGACY, ...RESERVED_CATEGORY_NAMES, ...labels, ...(await listCustomMenuCategories(db))]
    .filter((existing) => existing !== self)
  if (taken.some((existing) => sameName(existing, name))) {
    throw categoryError(409, 'That category already exists', 'duplicate')
  }
}

/** Adds a category; duplicates are matched ignoring case and outer spaces. Re-adding a deleted built-in restores it. */
async function createMenuCategory(db, raw) {
  const name = validCategoryName(raw)
  const settings = await loadBuiltInSettings(db)
  const deletedBuiltIn = MENU_CATEGORIES.find((key) => sameName(key, name) && settings.get(key)?.hidden)
  if (deletedBuiltIn) {
    await saveBuiltInSetting(db, deletedBuiltIn, {})
    return deletedBuiltIn
  }
  await assertCategoryNameFree(db, name)
  try {
    await db.execute('INSERT INTO menu_categories (name) VALUES (?)', [name])
  } catch (error) {
    // Two admins adding the same name at once: the UNIQUE key catches the second.
    if (error?.code === 'ER_DUP_ENTRY') throw categoryError(409, 'That category already exists', 'duplicate')
    throw error
  }
  return name
}

/** The category's key and whether it is built-in; 404 if it doesn't exist (or was deleted). */
async function findMenuCategory(db, raw) {
  const name = cleanCategoryName(raw)
  const settings = await loadBuiltInSettings(db)
  const builtIn = MENU_CATEGORIES.find((key) => sameName(key, name) && !settings.get(key)?.hidden)
  if (builtIn) return { key: builtIn, builtIn: true }
  const [rows] = await db.execute('SELECT name FROM menu_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
  if (!rows[0]) throw categoryError(404, 'That category no longer exists', 'not_found')
  return { key: rows[0].name, builtIn: false }
}

/**
 * Renames a category and returns its key. A built-in one keeps its key and gets a display label
 * (renaming it back to its own name clears the label); an added one is renamed and its menu items move with it.
 */
async function renameMenuCategory(db, rawCurrent, rawNext) {
  const { key, builtIn } = await findMenuCategory(db, rawCurrent)
  const name = validCategoryName(rawNext)
  if (builtIn) {
    if (name === key) {
      await saveBuiltInSetting(db, key, {})
      return key
    }
    await assertCategoryNameFree(db, name, key)
    await saveBuiltInSetting(db, key, { label: name })
    return key
  }
  if (name === key) return key
  // Changing only the letter case of its own name is fine; any other match is a duplicate.
  await assertCategoryNameFree(db, name, key)
  try {
    await db.execute('UPDATE menu_categories SET name = ? WHERE name = ?', [name, key])
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw categoryError(409, 'That category already exists', 'duplicate')
    throw error
  }
  await db.execute('UPDATE menu_items SET category = ? WHERE category = ?', [name, key])
  return name
}

/**
 * Deletes a category (a built-in one is hidden). Its menu items move to `rawMoveTo` first, which
 * is required while it has any. Returns the key and how many items moved.
 */
async function deleteMenuCategory(db, raw, rawMoveTo = null) {
  const { key, builtIn } = await findMenuCategory(db, raw)
  const [[{ count }]] = await db.execute('SELECT COUNT(*) AS count FROM menu_items WHERE category = ?', [key])
  let moved = Number(count)
  if (moved > 0) {
    const target = cleanCategoryName(rawMoveTo) ? await resolveMenuCategory(db, rawMoveTo) : null
    if (!target || target === key) {
      const error = categoryError(409, 'Choose a category to move its items to', 'in_use')
      error.count = moved
      throw error
    }
    moved = await withTransaction(db, async (conn) => {
      const [rows] = await conn.execute(
        'SELECT id, name, category FROM menu_items WHERE category IN (?, ?) FOR UPDATE',
        [key, target],
      )
      const targetNames = new Set(rows.filter((row) => row.category === target).map((row) => nameKey(row.name)))
      const source = rows.filter((row) => row.category === key)
      const clashes = [...new Set(source.filter((row) => targetNames.has(nameKey(row.name))).map((row) => row.name))]
      if (clashes.length) {
        const error = categoryError(409, `These items already exist in "${target}": ${clashes.join(', ')}. Rename them first.`, 'name_clash')
        error.names = clashes
        throw error
      }
      const [result] = await conn.execute('UPDATE menu_items SET category = ? WHERE category = ?', [target, key])
      return Number(result.affectedRows)
    })
  }
  if (builtIn) await saveBuiltInSetting(db, key, { hidden: true })
  else await db.execute('DELETE FROM menu_categories WHERE name = ?', [key])
  return { key, moved }
}

function isFoodCategory(category) {
  return !DRINK_CATEGORIES.has(category)
}

const PRICE_RANGE_ERROR = `Price must be more than 0 and no more than ${MAX_MENU_PRICE.toLocaleString('en-US')}`

function strictPrice(raw) {
  if (raw == null || raw === '') return { value: null }
  const n = Number(raw)
  if (typeof raw === 'boolean' || !Number.isFinite(n)) return { invalid: true }
  const rounded = Math.round(n * 100) / 100
  if (rounded <= 0 || rounded > MAX_MENU_PRICE) return { invalid: true }
  return { value: rounded }
}

function normalizeMenuPrices(body, category) {
  const hotCheck = strictPrice(body?.hot_price)
  const icedCheck = strictPrice(body?.iced_price)
  if (hotCheck.invalid || icedCheck.invalid) return { error: PRICE_RANGE_ERROR }
  const hot = hotCheck.value
  const iced = icedCheck.value

  // Any item may offer Hot/Ice servings (e.g. Matcha under Cold Drinks).
  if (hot != null || iced != null) {
    const offered = [hot, iced].filter((value) => value != null)
    return {
      price: Math.min(...offered),
      hot_price: hot,
      iced_price: iced,
    }
  }

  const priceCheck = strictPrice(body?.price)
  if (priceCheck.invalid) return { error: PRICE_RANGE_ERROR }
  const price = priceCheck.value
  if (price == null) {
    return {
      error: isFoodCategory(category)
        ? 'Please fill in all fields (Name, Category, Price)'
        : 'Enter a Hot price, an Iced price, or both',
    }
  }
  return { price, hot_price: null, iced_price: null }
}

function serializeMenuItem(row, now = new Date()) {
  const hasSales = Boolean(Number(row?.has_sales))
  const rawPrice = Number.parseFloat(row?.price)
  const hot = parseOptionalMoney(row?.hot_price)
  const iced = parseOptionalMoney(row?.iced_price)
  const fallback = hot ?? iced ?? 0
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : fallback

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price,
    hot_price: hot,
    iced_price: iced,
    image_url: normalizeMenuImageUrl(row.image_url),
    is_available: row.is_available === 0 || row.is_available === false ? false : true,
    unavailable_since: toIso(row.unavailable_since),
    has_sales: hasSales,
    ...computeMenuDeleteEligibility({
      has_sales: hasSales,
      is_available: row.is_available === 0 || row.is_available === false ? false : true,
      unavailable_since: row.unavailable_since,
      now,
    }),
  }
}

const MENU_ITEM_SELECT = `SELECT m.id, m.name, m.category, m.price, m.hot_price, m.iced_price, m.image_url, m.is_available,
       m.unavailable_since,
       EXISTS (SELECT 1 FROM order_items oi WHERE oi.menu_item_id = m.id) AS has_sales
FROM menu_items m`

async function loadMenuItemRow(db, id) {
  const [rows] = await db.execute(`${MENU_ITEM_SELECT} WHERE m.id = ? LIMIT 1`, [id])
  return rows[0] ?? null
}

async function ensureMenuItemsSchema(db) {
  if (!menuItemsSchemaReadyPromise) {
    menuItemsSchemaReadyPromise = (async () => {
      const hasImageUrl = await columnExists(db, 'menu_items', 'image_url')
      if (!hasImageUrl) {
        await db.execute(
          'ALTER TABLE menu_items ADD COLUMN image_url VARCHAR(512) NULL AFTER price',
        )
      }

      const hasHotPrice = await columnExists(db, 'menu_items', 'hot_price')
      if (!hasHotPrice) {
        await db.execute(
          'ALTER TABLE menu_items ADD COLUMN hot_price DECIMAL(10,2) NULL AFTER price',
        )
      }

      const hasIcedPrice = await columnExists(db, 'menu_items', 'iced_price')
      if (!hasIcedPrice) {
        await db.execute(
          'ALTER TABLE menu_items ADD COLUMN iced_price DECIMAL(10,2) NULL AFTER hot_price',
        )
      }

      if (!(await columnExists(db, 'menu_items', 'unavailable_since'))) {
        await db.execute('ALTER TABLE menu_items ADD COLUMN unavailable_since DATETIME NULL')
      }
      await db.execute(
        'UPDATE menu_items SET unavailable_since = NOW() WHERE is_available = 0 AND unavailable_since IS NULL',
      )

      if (!(await columnExists(db, 'order_items', 'item_category'))) {
        await db.execute('ALTER TABLE order_items ADD COLUMN item_category VARCHAR(100) NULL')
        await db.execute(
          `UPDATE order_items oi
           JOIN menu_items m ON m.id = oi.menu_item_id
           SET oi.item_category = m.category
           WHERE oi.item_category IS NULL AND oi.menu_item_id IS NOT NULL`,
        )
      }

      // category was an ENUM of the built-in names; added categories need free text.
      // VARCHAR keeps every stored value, so this is a one-time, lossless change.
      const [categoryColumn] = await db.execute(
        `SELECT DATA_TYPE AS dataType
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND COLUMN_NAME = 'category'
         LIMIT 1`,
      )
      if (String(categoryColumn[0]?.dataType || '').toLowerCase() === 'enum') {
        await db.execute('ALTER TABLE menu_items MODIFY category VARCHAR(50) NOT NULL')
      }

      await db.execute(
        `CREATE TABLE IF NOT EXISTS menu_categories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(50) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_menu_category_name (name)
        )`,
      )

      await db.execute(
        `CREATE TABLE IF NOT EXISTS menu_category_settings (
          name VARCHAR(50) NOT NULL PRIMARY KEY,
          label VARCHAR(50) NULL,
          hidden TINYINT(1) NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
      )
    })().catch((error) => {
      menuItemsSchemaReadyPromise = null
      throw error
    })
  }

  return menuItemsSchemaReadyPromise
}

// Built-in categories in their fixed order; anything else (added categories) after them.
function menuCategoryFieldSql(column = 'category') {
  const field = `FIELD(${column}, ${MENU_CATEGORIES.map((value) => `'${value}'`).join(', ')})`
  return `${field} = 0, ${field}, ${column}`
}

module.exports = {
  MENU_CATEGORIES,
  MENU_CATEGORIES_WITH_LEGACY,
  MENU_CATEGORY_NAME_MAX,
  createMenuCategory,
  renameMenuCategory,
  deleteMenuCategory,
  getMenuCategories,
  listMenuCategories,
  resolveMenuCategory,
  menuCategoryFieldSql,
  MENU_ITEM_SELECT,
  loadMenuItemRow,
  ensureMenuItemsSchema,
  ensureMenuItemsImageSchema: ensureMenuItemsSchema,
  normalizeMenuImageUrl,
  parseMenuImageUrl,
  MAX_MENU_PRICE,
  normalizeMenuCategory,
  normalizeMenuPrices,
  parseOptionalMoney,
  serializeMenuItem,
}
