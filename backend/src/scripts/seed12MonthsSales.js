/**
 * Seeds completed sales from 1 June 2025 through today using the live menu_items table.
 * Dish names always match the current catalog (no bakery / old drink names).
 * Run: npm run seed:sales
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') })

const db = require('../../db')

const TAX_RATE = 0
const START_DATE = new Date(2025, 5, 1)
const PAYMENT_METHODS = ['Cash', 'Bank Scan']
const INVOICE_PREFIX = 'RC-'
const DRINK_CATEGORIES = new Set(['Coffee', 'Tea'])

const MORNING_HOURS = [7, 8, 9, 10]
const LUNCH_HOURS = [11, 12, 13]
const AFTERNOON_HOURS = [14, 15, 16]
const EVENING_HOURS = [17, 18, 19, 20]

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickWeighted(items, weightFn) {
  const weights = items.map(weightFn)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return items[randomInt(0, items.length - 1)]
  let roll = Math.random() * total
  for (let index = 0; index < items.length; index += 1) {
    roll -= weights[index]
    if (roll <= 0) return items[index]
  }
  return items[items.length - 1]
}

function resolveEndDate(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (now.getHours() < 7) {
    today.setDate(today.getDate() - 1)
  }
  return today
}

function pickOrderHour(month, now, orderDay) {
  const isHotSeason = month >= 3 && month <= 5
  const bucket = Math.random()
  let hour
  if (isHotSeason && bucket < 0.38) hour = pickWeighted(AFTERNOON_HOURS, () => 1.5)
  else if (bucket < 0.42) hour = pickWeighted(MORNING_HOURS, () => 1)
  else if (bucket < 0.74) hour = pickWeighted(LUNCH_HOURS, () => 1.2)
  else if (bucket < 0.9) hour = pickWeighted(AFTERNOON_HOURS, () => 1)
  else hour = pickWeighted(EVENING_HOURS, () => 1)

  const sameDay =
    orderDay.getFullYear() === now.getFullYear()
    && orderDay.getMonth() === now.getMonth()
    && orderDay.getDate() === now.getDate()
  if (sameDay && hour > now.getHours()) {
    hour = Math.max(7, now.getHours())
  }
  return hour
}

function getSeasonProfile(month, day) {
  if (month === 11 || month === 12 || month <= 2) {
    return {
      name: 'high-season',
      volumeMultiplier: 1.35,
      takeoutRatio: 0.16,
      icedChance: 0.18,
    }
  }

  if (month >= 3 && month <= 5) {
    const knySurge = month === 4 && day >= 13 && day <= 16 ? 1.55 : 1.12
    return {
      name: 'hot-season',
      volumeMultiplier: knySurge,
      takeoutRatio: 0.26,
      icedChance: 0.82,
    }
  }

  const pchumBenSurge =
    (month === 9 && day >= 18) || (month === 10 && day <= 8) ? 1.18 : 1.0
  return {
    name: 'rainy-season',
    volumeMultiplier: pchumBenSurge,
    takeoutRatio: 0.38,
    icedChance: 0.42,
  }
}

function getDailyOrderCount(date) {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const weekday = date.getDay()
  const profile = getSeasonProfile(month, day)

  const base = randomInt(10, 17)
  const weekendBoost = weekday === 0 || weekday === 6 ? 1.2 : 1
  const weekdayDip = weekday === 1 ? 0.9 : 1
  return Math.max(5, Math.round(base * profile.volumeMultiplier * weekendBoost * weekdayDip))
}

function categoryWeight(category, hour, season) {
  const morning = hour >= 7 && hour <= 10
  const lunch = hour >= 11 && hour <= 14
  const afternoon = hour >= 15 && hour <= 16
  const evening = hour >= 17

  switch (category) {
    case 'Coffee':
      if (morning) return season === 'hot-season' ? 4.8 : 7.2
      if (afternoon) return season === 'hot-season' ? 3.6 : 3.1
      return 2.2
    case 'Tea':
      if (morning) return 3.4
      if (afternoon) return 3.6
      return 1.7
    case 'Cold Drinks':
      if (season === 'hot-season') return afternoon || lunch ? 5.6 : 3.4
      if (season === 'high-season') return 1.3
      return 2.3
    case 'Beer':
      if (evening) return 5.8
      if (lunch) return 1.5
      return 0.3
    case 'Starters':
      if (lunch || evening) return 3.3
      return 0.7
    case 'Mains':
      if (lunch) return 6.6
      if (evening) return 5.9
      return 1.1
    case 'Soup':
      if (season === 'rainy-season' && (lunch || evening)) return 4.4
      if (lunch || evening) return 2.7
      return 0.5
    case 'Vegetable':
      if (lunch || evening) return 2.5
      return 0.4
    case 'Dessert':
      if (lunch || afternoon || evening) return 2.5
      return 0.6
    default:
      return 1
  }
}

function unitPrice(item, preferIced) {
  const hot = item.hot_price
  const iced = item.iced_price
  if (DRINK_CATEGORIES.has(item.category)) {
    if (preferIced && iced != null) return iced
    if (!preferIced && hot != null) return hot
    if (hot != null) return hot
    if (iced != null) return iced
  }
  return item.price
}

function buildOrderLines(menuItems, profile, hour) {
  const morning = hour <= 10
  const lunch = hour >= 11 && hour <= 14
  const evening = hour >= 17
  const lineCount = morning ? randomInt(1, 2) : lunch ? randomInt(2, 4) : evening ? randomInt(1, 3) : randomInt(1, 3)
  const preferIced = Math.random() < profile.icedChance || hour >= 12
  const lines = []

  for (let index = 0; index < lineCount; index += 1) {
    const item = pickWeighted(menuItems, (menuItem) => (
      categoryWeight(menuItem.category, hour, profile.name)
    ))
    const quantity = item.category === 'Beer' ? randomInt(1, 3) : randomInt(1, 2)
    const price = unitPrice(item, preferIced)
    lines.push({
      menu_item_id: item.id,
      item_name: item.name,
      quantity,
      price,
      lineTotal: roundMoney(quantity * price),
    })
  }

  return lines
}

function formatInvoiceId(counter) {
  return `${INVOICE_PREFIX}${String(counter).padStart(6, '0')}`
}

function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function eachDay(start, end, callback) {
  const cursor = new Date(start)
  while (cursor <= end) {
    callback(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
}

function roundMoney(value) {
  return Math.round(value * 100) / 100
}

function formatMysqlDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function loadLiveMenu(conn) {
  const [rows] = await conn.execute(`
    SELECT id, name, category, price, hot_price, iced_price
    FROM menu_items
    ORDER BY id
  `)

  if (!rows.length) {
    throw new Error('No menu items in the database. Run npm run seed:menu first.')
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number.parseFloat(row.price),
    hot_price: row.hot_price == null ? null : Number.parseFloat(row.hot_price),
    iced_price: row.iced_price == null ? null : Number.parseFloat(row.iced_price),
  }))
}

async function ensureFloorTables(conn) {
  const [rows] = await conn.execute('SELECT id FROM tables ORDER BY id')
  if (!rows.length) {
    throw new Error('No floor tables found. Run backend/seeds/004_floor_tables.sql first.')
  }
  return rows.map((row) => row.id)
}

async function wipeCompletedSales(conn) {
  await conn.query(
    `DELETE oi FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id
     WHERE UPPER(TRIM(o.status)) IN ('COMPLETED', 'PAID')`,
  )
  const [result] = await conn.query(
    `DELETE FROM orders WHERE UPPER(TRIM(status)) IN ('COMPLETED', 'PAID')`,
  )
  return result.affectedRows || 0
}

function generateSales(menuItems, tableIds, startDate, endDate, now) {
  const orders = []
  let invoiceCounter = 300001

  eachDay(startDate, endDate, (day) => {
    const profile = getSeasonProfile(day.getMonth() + 1, day.getDate())
    const orderCount = getDailyOrderCount(day)

    for (let index = 0; index < orderCount; index += 1) {
      const orderDate = new Date(day)
      const hour = pickOrderHour(day.getMonth() + 1, now, day)
      orderDate.setHours(hour, randomInt(0, 59), randomInt(0, 59), 0)

      const lines = buildOrderLines(menuItems, profile, hour)
      const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0))
      const tax = roundMoney(subtotal * TAX_RATE)
      const total = roundMoney(subtotal + tax)
      const paymentMethod = PAYMENT_METHODS[Math.random() < 0.55 ? 0 : 1]
      const isTakeOut = Math.random() < profile.takeoutRatio
      const timestamp = formatMysqlDateTime(orderDate)

      orders.push({
        tableId: isTakeOut ? null : tableIds[randomInt(0, tableIds.length - 1)],
        sourceType: isTakeOut ? 'Take Out' : 'Table',
        paymentMethod,
        subtotal,
        tax,
        total,
        timestamp,
        invoiceId: formatInvoiceId(invoiceCounter),
        season: profile.name,
        monthKey: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`,
        lines,
      })
      invoiceCounter += 1
    }
  })

  return orders
}

async function insertSales(conn, orders) {
  const chunkSize = 150
  for (let index = 0; index < orders.length; index += chunkSize) {
    const chunk = orders.slice(index, index + chunkSize)
    const orderRows = chunk.map((order) => [
      order.tableId,
      order.tableId,
      order.sourceType,
      order.total,
      order.paymentMethod,
      'Completed',
      order.invoiceId,
      order.paymentMethod,
      order.subtotal,
      order.tax,
      order.total,
      order.timestamp,
      order.timestamp,
    ])

    // Direct insert only. Do not reconcile stock: simulated history must not deduct or log movements.
    const [result] = await conn.query(
      `INSERT INTO orders
        (target_id, table_id, source_type, total_amount, payment_type, status,
         invoice_id, payment_method, subtotal, tax, total, created_at, updated_at)
       VALUES ?`,
      [orderRows],
    )

    let orderId = result.insertId
    const itemRows = []
    for (const order of chunk) {
      for (const line of order.lines) {
        itemRows.push([
          orderId,
          line.menu_item_id,
          line.item_name,
          line.quantity,
          line.price,
          line.lineTotal,
        ])
      }
      orderId += 1
    }

    if (itemRows.length) {
      await conn.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal)
         VALUES ?`,
        [itemRows],
      )
    }
  }
}

async function seed12MonthsSales() {
  const now = new Date()
  const endDate = resolveEndDate(now)

  console.log('═══════════════════════════════════════════════════════')
  console.log('  Mlu Kitchen & Cafe Siem Reap — Sales Seed')
  console.log(`  Period: 1 June 2025 → ${formatLocalDate(endDate)}`)
  console.log('  Catalog: live menu_items (current dish names)')
  console.log('═══════════════════════════════════════════════════════')
  console.log('')

  const conn = await db.getConnection()
  try {
    console.log('[1/4] Loading current menu & floor tables...')
    const menuItems = await loadLiveMenu(conn)
    const tableIds = await ensureFloorTables(conn)
    const names = menuItems.map((item) => item.name).sort((a, b) => a.localeCompare(b))
    console.log(`      ✓ ${menuItems.length} live menu items`)
    console.log(`      ✓ ${tableIds.length} floor tables`)
    console.log(`      ✓ ${names.join(', ')}`)

    await conn.beginTransaction()

    console.log('[2/4] Clearing completed sales (open tickets kept)...')
    const wiped = await wipeCompletedSales(conn)
    console.log(`      ✓ ${wiped} completed orders removed`)

    console.log('[3/4] Generating daily tickets from the current menu...')
    const orders = generateSales(menuItems, tableIds, START_DATE, endDate, now)
    await insertSales(conn, orders)
    await conn.commit()
    console.log(`      ✓ ${orders.length.toLocaleString()} completed orders inserted`)

    console.log('[4/4] Verifying database totals...')
    const [summary] = await conn.execute(`
      SELECT
        COUNT(*) AS order_count,
        MIN(updated_at) AS earliest_sale,
        MAX(updated_at) AS latest_sale,
        SUM(total) AS gross_revenue
      FROM orders
      WHERE UPPER(status) IN ('COMPLETED', 'PAID')
    `)
    const [itemNames] = await conn.execute(`
      SELECT COALESCE(oi.item_name, m.name) AS name, COUNT(*) AS sold
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      LEFT JOIN menu_items m ON m.id = oi.menu_item_id
      WHERE UPPER(o.status) IN ('COMPLETED', 'PAID')
      GROUP BY COALESCE(oi.item_name, m.name)
      ORDER BY sold DESC
    `)

    const takeoutOrders = orders.filter((order) => order.sourceType === 'Take Out').length
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0)
    const monthStats = {}
    for (const order of orders) {
      if (!monthStats[order.monthKey]) {
        monthStats[order.monthKey] = { orders: 0, revenue: 0, takeout: 0, season: order.season }
      }
      monthStats[order.monthKey].orders += 1
      monthStats[order.monthKey].revenue += order.total
      if (order.sourceType === 'Take Out') monthStats[order.monthKey].takeout += 1
    }

    const liveNames = new Set(menuItems.map((item) => item.name))
    const unknown = itemNames.filter((row) => !liveNames.has(row.name))

    console.log('')
    console.log('═══════════════════════════════════════════════════════')
    console.log('  SEED COMPLETE')
    console.log('═══════════════════════════════════════════════════════')
    console.log(`  Total orders generated : ${orders.length.toLocaleString()}`)
    console.log(`  Gross revenue          : $${totalRevenue.toFixed(2)}`)
    console.log(`  Take-out share         : ${((takeoutOrders / orders.length) * 100).toFixed(1)}%`)
    console.log(`  Date range             : ${summary[0].earliest_sale} → ${summary[0].latest_sale}`)
    console.log(`  Distinct dishes sold   : ${itemNames.length} (menu has ${menuItems.length})`)
    if (unknown.length) {
      console.log(`  ⚠ Names not on menu    : ${unknown.map((row) => row.name).join(', ')}`)
    } else {
      console.log('  All sold names match the current menu')
    }
    console.log('')
    console.log('  Top sellers:')
    itemNames.slice(0, 12).forEach((row) => {
      console.log(`    ${String(row.sold).padStart(5)}  ${row.name}`)
    })
    console.log('')
    console.log('  Monthly breakdown:')
    Object.entries(monthStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([monthKey, stats]) => {
        const label = stats.season.replace('-', ' ')
        console.log(
          `    ${monthKey}  ${String(stats.orders).padStart(4)} orders  `
          + `$${stats.revenue.toFixed(2).padStart(9)}  `
          + `[${label}]  ${stats.takeout} takeout`,
        )
      })
    console.log('═══════════════════════════════════════════════════════')
  } catch (error) {
    try { await conn.rollback() } catch { /* ignore */ }
    throw error
  } finally {
    conn.release()
  }
}

seed12MonthsSales()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('')
    console.error('❌ Sales seed failed:', error.message)
    process.exit(1)
  })
