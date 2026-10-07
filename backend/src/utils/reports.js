const {
  refundDateSql,
  refundedStatusSql,
  saleStatusSql,
  salesAndRefunds,
} = require('./salesTotals')

const ALLOWED_DAY_RANGES = [30, 60, 90, 120, 180, 365, 730]
const COMPLETED_STATUSES = saleStatusSql('o')
const REFUNDED_STATUS = refundedStatusSql('o')
const REFUND_DATE = refundDateSql('o')

const BASE_ITEM_NAME_SQL = `IF(oi.notes IS NOT NULL AND oi.notes <> '' AND CHAR_LENGTH(oi.item_name) > CHAR_LENGTH(oi.notes) + 3 AND RIGHT(oi.item_name, CHAR_LENGTH(oi.notes) + 3) = CONCAT(' (', oi.notes, ')'), LEFT(oi.item_name, CHAR_LENGTH(oi.item_name) - CHAR_LENGTH(oi.notes) - 3), oi.item_name)`

function resolveDayRange(rawDays) {
  const parsed = Number.parseInt(rawDays, 10)
  return ALLOWED_DAY_RANGES.includes(parsed) ? parsed : 30
}

function money(value) {
  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0
}

function count(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

async function buildSalesReport(db, { days } = {}) {
  const rangeDays = resolveDayRange(days)

  const [[totals]] = await db.execute(
    `
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(o.subtotal), 0) AS subtotal,
      COALESCE(SUM(o.tax), 0) AS tax,
      COALESCE(SUM(COALESCE(o.total, o.total_amount)), 0) AS revenue
    FROM orders o
    WHERE ${COMPLETED_STATUSES}
      AND o.updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `,
    [rangeDays],
  )

  const [[refundTotals]] = await db.execute(
    `
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(COALESCE(o.total, o.total_amount)), 0) AS amount
    FROM orders o
    WHERE ${REFUNDED_STATUS}
      AND ${REFUND_DATE} >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `,
    [rangeDays],
  )

  const [[today]] = await db.execute(
    `
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(COALESCE(o.total, o.total_amount)), 0) AS revenue
    FROM orders o
    WHERE ${COMPLETED_STATUSES}
      AND DATE(o.updated_at) = CURDATE()
    `,
  )

  const [[todayRefunds]] = await db.execute(
    `
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(COALESCE(o.total, o.total_amount)), 0) AS amount
    FROM orders o
    WHERE ${REFUNDED_STATUS}
      AND DATE(${REFUND_DATE}) = CURDATE()
    `,
  )

  const period = salesAndRefunds({
    orders: totals?.order_count,
    sales: totals?.revenue,
    refundOrders: refundTotals?.order_count,
    refunds: refundTotals?.amount,
  })
  const day = salesAndRefunds({
    orders: today?.order_count,
    sales: today?.revenue,
    refundOrders: todayRefunds?.order_count,
    refunds: todayRefunds?.amount,
  })

  const [byPaymentMethod] = await db.execute(
    `
    SELECT
      COALESCE(NULLIF(o.payment_method, ''), NULLIF(o.payment_type, ''), 'Cash') AS method,
      COUNT(*) AS order_count,
      COALESCE(SUM(COALESCE(o.total, o.total_amount)), 0) AS revenue
    FROM orders o
    WHERE ${COMPLETED_STATUSES}
      AND o.updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY method
    ORDER BY revenue DESC, method ASC
    `,
    [rangeDays],
  )

  const [bySource] = await db.execute(
    `
    SELECT
      CASE
        WHEN o.source_type = 'Take Out' OR o.target_id IS NULL THEN 'Take Out'
        ELSE 'Dine In'
      END AS source,
      COUNT(*) AS order_count,
      COALESCE(SUM(COALESCE(o.total, o.total_amount)), 0) AS revenue
    FROM orders o
    WHERE ${COMPLETED_STATUSES}
      AND o.updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY source
    ORDER BY revenue DESC
    `,
    [rangeDays],
  )

  const [topItems] = await db.execute(
    `
    SELECT
      COALESCE(m.name, ${BASE_ITEM_NAME_SQL}, 'Custom item') AS name,
      COALESCE(oi.item_category, m.category, 'Uncategorized') AS category,
      COALESCE(SUM(oi.quantity), 0) AS quantity,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE ${COMPLETED_STATUSES}
      AND o.updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY COALESCE(m.name, ${BASE_ITEM_NAME_SQL}, 'Custom item'), COALESCE(oi.item_category, m.category, 'Uncategorized')
    ORDER BY revenue DESC, quantity DESC
    LIMIT 10
    `,
    [rangeDays],
  )

  const [byCategory] = await db.execute(
    `
    SELECT
      COALESCE(oi.item_category, m.category, 'Uncategorized') AS category,
      COALESCE(SUM(oi.quantity), 0) AS quantity,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN menu_items m ON m.id = oi.menu_item_id
    WHERE ${COMPLETED_STATUSES}
      AND o.updated_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    GROUP BY COALESCE(oi.item_category, m.category, 'Uncategorized')
    ORDER BY revenue DESC, category ASC
    `,
    [rangeDays],
  )

  return {
    generatedAt: new Date().toISOString(),
    range: {
      days: rangeDays,
      allowed: ALLOWED_DAY_RANGES,
    },
    totals: {
      orders: period.orders,
      subtotal: money(totals?.subtotal),
      tax: 0,
      revenue: period.sales,
      sales: period.sales,
      refundOrders: period.refundOrders,
      refunds: period.refunds,
      net: period.net,
    },
    today: {
      orders: day.orders,
      revenue: day.sales,
      sales: day.sales,
      refundOrders: day.refundOrders,
      refunds: day.refunds,
      net: day.net,
    },
    byPaymentMethod: byPaymentMethod.map((row) => ({
      method: row.method || 'Cash',
      orders: count(row.order_count),
      revenue: money(row.revenue),
    })),
    bySource: bySource.map((row) => ({
      source: row.source,
      orders: count(row.order_count),
      revenue: money(row.revenue),
    })),
    byCategory: byCategory.map((row) => ({
      category: row.category,
      quantity: count(row.quantity),
      revenue: money(row.revenue),
    })),
    topItems: topItems.map((row) => ({
      name: row.name,
      category: row.category,
      quantity: count(row.quantity),
      revenue: money(row.revenue),
    })),
  }
}

module.exports = {
  ALLOWED_DAY_RANGES,
  buildSalesReport,
}
