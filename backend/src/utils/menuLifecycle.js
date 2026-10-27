const MENU_DELETE_COOLDOWN_DAYS = 7
const MENU_NAME_MAX = 100

function collapseSpaces(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ')
}

function nameKey(raw) {
  return collapseSpaces(raw).toLowerCase()
}
const DAY_MS = 24 * 60 * 60 * 1000

function toDate(value) {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toIso(value) {
  const date = toDate(value)
  return date ? date.toISOString() : null
}

function computeMenuDeleteEligibility({ has_sales, is_available, unavailable_since, now = new Date() } = {}) {
  if (!has_sales) return { can_delete: true, delete_block_reason: null, delete_available_at: null }
  if (is_available) return { can_delete: false, delete_block_reason: 'on_sale', delete_available_at: null }

  const current = toDate(now) ?? new Date()
  const since = toDate(unavailable_since) ?? current
  const availableAt = new Date(since.getTime() + MENU_DELETE_COOLDOWN_DAYS * DAY_MS)
  if (current.getTime() >= availableAt.getTime()) {
    return { can_delete: true, delete_block_reason: null, delete_available_at: null }
  }
  return { can_delete: false, delete_block_reason: 'cooling_down', delete_available_at: availableAt.toISOString() }
}

// Letters in any script (Khmer included), digits, spaces and the punctuation menus use
// ("Tea W/ Honey & Lemon", "Kulen Water (1.5L)", "Chef's 100% Juice").
const MENU_NAME_PATTERN = /^[\p{L}\p{M}\p{N} &'’().,/+%#!?:-]+$/u

function normalizeMenuItemName(raw) {
  if (typeof raw !== 'string') return { error: 'Please fill in all fields (Name, Category, Price)', code: 'required' }
  const name = collapseSpaces(raw)
  if (!name) return { error: 'Please fill in all fields (Name, Category, Price)', code: 'required' }
  if (name.length > MENU_NAME_MAX) return { error: `Use ${MENU_NAME_MAX} characters or fewer`, code: 'too_long' }
  if (!MENU_NAME_PATTERN.test(name) || name.includes('--')) {
    return { error: "Use letters, numbers, spaces and & ' ( ) . , / + % # ! ? : - only", code: 'invalid_chars' }
  }
  return { name }
}

function parseOptionalAvailability(raw) {
  if (raw === undefined) return { value: undefined }
  if (raw === true || raw === 1) return { value: true }
  if (raw === false || raw === 0) return { value: false }
  return { error: 'is_available must be true or false' }
}

async function findDuplicateMenuName(db, name, category, excludeId = null) {
  const [rows] = await db.execute(
    'SELECT name FROM menu_items WHERE category = ? AND id <> ?',
    [category, excludeId ?? 0],
  )
  const wanted = nameKey(name)
  return rows.some((row) => nameKey(row.name) === wanted)
}

module.exports = {
  collapseSpaces,
  nameKey,
  MENU_DELETE_COOLDOWN_DAYS,
  MENU_NAME_MAX,
  computeMenuDeleteEligibility,
  findDuplicateMenuName,
  normalizeMenuItemName,
  parseOptionalAvailability,
  toIso,
}
