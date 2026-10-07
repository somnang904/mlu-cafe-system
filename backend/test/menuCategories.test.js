const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createMenuCategory,
  deleteMenuCategory,
  getMenuCategories,
  listMenuCategories,
  renameMenuCategory,
  resolveMenuCategory,
  MENU_CATEGORIES,
} = require('../src/utils/menuItemsSchema')

// Just enough of the mysql2 pool for the menu_categories queries.
// `items` holds the category of each menu item; `settings` the built-in key -> { label, hidden } rows.
function fakeDb(names = [], items = [], itemNames = items.map((_, index) => `Item ${index}`)) {
  const rows = [...names]
  const settings = new Map()
  const db = {
    rows,
    items,
    settings,
    async getConnection() {
      return { execute: db.execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }
    },
    async execute(sql, params = []) {
      if (sql.startsWith('SELECT id, name, category FROM menu_items')) {
        return [items.map((category, index) => ({ id: index + 1, name: itemNames[index], category })).filter((row) => params.includes(row.category))]
      }
      if (sql.startsWith('SELECT name, label, hidden FROM menu_category_settings')) {
        return [[...settings].map(([name, setting]) => ({ name, label: setting.label, hidden: setting.hidden }))]
      }
      if (sql.startsWith('INSERT INTO menu_category_settings')) {
        settings.set(params[0], { label: params[1], hidden: params[2] })
        return [{}]
      }
      if (sql.startsWith('UPDATE menu_categories SET name')) {
        rows[rows.indexOf(params[1])] = params[0]
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('UPDATE menu_items SET category')) {
        let affectedRows = 0
        items.forEach((category, index) => {
          if (category === params[1]) {
            items[index] = params[0]
            affectedRows += 1
          }
        })
        return [{ affectedRows }]
      }
      if (sql.startsWith('SELECT COUNT(*) AS count FROM menu_items')) {
        return [[{ count: items.filter((category) => category === params[0]).length }]]
      }
      if (sql.startsWith('DELETE FROM menu_categories')) {
        rows.splice(rows.indexOf(params[0]), 1)
        return [{ affectedRows: 1 }]
      }
      if (sql.startsWith('SELECT name FROM menu_categories WHERE')) {
        const match = rows.find((name) => name.toLowerCase() === String(params[0]).toLowerCase())
        return [match ? [{ name: match }] : []]
      }
      if (sql.startsWith('SELECT name FROM menu_categories')) return [rows.map((name) => ({ name }))]
      if (sql.startsWith('INSERT INTO menu_categories')) {
        rows.push(params[0])
        return [{ insertId: rows.length }]
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  return db
}

test('a new category is trimmed and listed after the built-in ones', async () => {
  const db = fakeDb(['Smoothies'])
  assert.equal(await createMenuCategory(db, '  Rice   Bowls '), 'Rice Bowls')
  assert.deepEqual(await listMenuCategories(db), [...MENU_CATEGORIES, 'Smoothies', 'Rice Bowls'])
})

test('duplicates are rejected ignoring case and outer spaces', async () => {
  const db = fakeDb(['Smoothies'])
  for (const name of [' smoothies ', 'COFFEE', 'all', 'Bakery']) {
    await assert.rejects(createMenuCategory(db, name), { status: 409, code: 'duplicate' })
  }
})

test('empty and over-long names are rejected', async () => {
  const db = fakeDb()
  await assert.rejects(createMenuCategory(db, '   '), { status: 400, code: 'required' })
  await assert.rejects(createMenuCategory(db, 'x'.repeat(25)), { status: 400, code: 'too_long' })
  assert.equal(db.rows.length, 0)
})

test('menu items accept built-in and added categories only', async () => {
  const db = fakeDb(['Smoothies'])
  assert.equal(await resolveMenuCategory(db, 'Tea'), 'Tea')
  assert.equal(await resolveMenuCategory(db, 'smoothies'), 'Smoothies')
  assert.equal(await resolveMenuCategory(db, 'Pizza'), null)
})

test('renaming an added category moves its menu items too', async () => {
  const db = fakeDb(['Smoothies', 'Bowls'], ['Smoothies', 'Tea', 'Smoothies'])
  assert.equal(await renameMenuCategory(db, 'smoothies', '  Fruit   Shakes '), 'Fruit Shakes')
  assert.deepEqual(db.rows, ['Fruit Shakes', 'Bowls'])
  assert.deepEqual(db.items, ['Fruit Shakes', 'Tea', 'Fruit Shakes'])
  // Only the letter case of its own name changes: not a duplicate.
  assert.equal(await renameMenuCategory(db, 'Fruit Shakes', 'FRUIT SHAKES'), 'FRUIT SHAKES')
})

test('rename rejects duplicates, empty names and missing categories', async () => {
  const db = fakeDb(['Smoothies', 'Bowls'])
  for (const name of ['bowls', 'Coffee', 'All']) {
    await assert.rejects(renameMenuCategory(db, 'Smoothies', name), { status: 409, code: 'duplicate' })
  }
  await assert.rejects(renameMenuCategory(db, 'Smoothies', '  '), { status: 400, code: 'required' })
  await assert.rejects(renameMenuCategory(db, 'Pizza', 'Pies'), { status: 404, code: 'not_found' })
  assert.deepEqual(db.rows, ['Smoothies', 'Bowls'])
})

test('a category with items is deleted only after they move to another one', async () => {
  const db = fakeDb(['Smoothies', 'Bowls'], ['Smoothies', 'Tea', 'Smoothies'])
  // No target, itself, or a category that doesn't exist: nothing changes.
  for (const moveTo of [null, 'smoothies', 'Pizza']) {
    await assert.rejects(deleteMenuCategory(db, 'Smoothies', moveTo), { status: 409, code: 'in_use', count: 2 })
  }
  assert.deepEqual(db.items, ['Smoothies', 'Tea', 'Smoothies'])
  assert.deepEqual(await deleteMenuCategory(db, 'Smoothies', 'bowls'), { key: 'Smoothies', moved: 2 })
  assert.deepEqual(db.items, ['Bowls', 'Tea', 'Bowls'])
  assert.deepEqual(db.rows, ['Bowls'])
  // An empty one needs no target.
  assert.deepEqual(await deleteMenuCategory(db, 'Bowls', 'Coffee'), { key: 'Bowls', moved: 2 })
  assert.deepEqual(db.items, ['Coffee', 'Tea', 'Coffee'])
  assert.deepEqual(await deleteMenuCategory(db, 'Dessert'), { key: 'Dessert', moved: 0 })
})

test('moving items into a category that already has the same names is refused and nothing moves', async () => {
  const db = fakeDb(['Smoothies', 'Bowls'], ['Smoothies', 'Bowls', 'Smoothies'], ['Mango  Shake', 'mango shake', 'Kiwi'])
  await assert.rejects(deleteMenuCategory(db, 'Smoothies', 'Bowls'), (error) => error.status === 409 && error.code === 'name_clash' && error.names.join() === 'Mango  Shake')
  assert.deepEqual(db.items, ['Smoothies', 'Bowls', 'Smoothies'])
  assert.deepEqual(db.rows, ['Smoothies', 'Bowls'])
})

test('a built-in category is renamed with a display label; its items keep the key', async () => {
  const db = fakeDb(['Smoothies'], ['Dessert', 'Dessert'])
  assert.equal(await renameMenuCategory(db, 'dessert', '  Sweets '), 'Dessert')
  assert.deepEqual(db.items, ['Dessert', 'Dessert'])
  const { categories, labels } = await getMenuCategories(db)
  assert.deepEqual(categories, [...MENU_CATEGORIES, 'Smoothies'])
  assert.deepEqual(labels, { Dessert: 'Sweets' })
  // The label is taken now, and so is the key itself.
  for (const name of ['sweets', 'Dessert']) {
    await assert.rejects(createMenuCategory(db, name), { status: 409, code: 'duplicate' })
  }
  await assert.rejects(renameMenuCategory(db, 'Smoothies', 'SWEETS'), { status: 409, code: 'duplicate' })
  // Renaming it back to its own name clears the label.
  assert.equal(await renameMenuCategory(db, 'Dessert', 'Dessert'), 'Dessert')
  assert.deepEqual((await getMenuCategories(db)).labels, {})
})

test('deleting a built-in hides it; adding the name again restores it', async () => {
  const db = fakeDb([], ['Coffee'])
  await assert.rejects(deleteMenuCategory(db, 'Coffee'), { status: 409, code: 'in_use', count: 1 })
  assert.deepEqual(await deleteMenuCategory(db, 'Dessert'), { key: 'Dessert', moved: 0 })
  // A deleted category can't receive moved items.
  await assert.rejects(deleteMenuCategory(db, 'Coffee', 'Dessert'), { status: 409, code: 'in_use' })
  assert.ok(!(await listMenuCategories(db)).includes('Dessert'))
  // Hidden: no new items, no rename, no second delete.
  assert.equal(await resolveMenuCategory(db, 'Dessert'), null)
  await assert.rejects(renameMenuCategory(db, 'Dessert', 'Sweets'), { status: 404, code: 'not_found' })
  assert.equal(await createMenuCategory(db, 'dessert'), 'Dessert')
  assert.deepEqual(await listMenuCategories(db), MENU_CATEGORIES)
  assert.deepEqual(db.rows, [])
})
