const ExcelJS = require('exceljs')
const { buildOrderPeriodClause } = require('./backupPeriod')

const PAGE = 500
const COMPLETED = `UPPER(status) IN ('COMPLETED', 'PAID')`
const orderPeriod = buildOrderPeriodClause('updated_at')
const expensePeriod = buildOrderPeriodClause('expense_date')
const movementPeriod = buildOrderPeriodClause('created_at')

function asNumber(value) {
  if (value == null || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function periodClause(builder, period, alias = '') {
  const filter = builder(period)
  if (!filter.clause) return { clause: '', params: [] }
  const clause = alias
    ? filter.clause.replace(/\b(updated_at|expense_date|created_at)\b/g, `${alias}.$1`)
    : filter.clause
  return { clause: ` AND ${clause}`, params: filter.params }
}

async function writePagedSheet(workbook, { name, columns, query, params }) {
  const sheet = workbook.addWorksheet(name)
  sheet.columns = columns
  let lastId = 0
  for (;;) {
    const [rows] = await query(lastId)
    if (!rows.length) break
    for (const row of rows) {
      sheet.addRow(row).commit()
    }
    lastId = rows[rows.length - 1].id
    if (rows.length < PAGE) break
  }
  sheet.commit()
  return params
}

async function writeSalesSheet(workbook, db, period) {
  const filter = periodClause(orderPeriod, period)
  await writePagedSheet(workbook, {
    name: 'Sales',
    columns: [
      { header: 'Order ID', key: 'id', width: 12 },
      { header: 'Invoice', key: 'invoice', width: 16 },
      { header: 'Source', key: 'source', width: 16 },
      { header: 'Payment', key: 'payment', width: 14 },
      { header: 'Bank', key: 'bank', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Tax', key: 'tax', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Total', key: 'total', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Sold at', key: 'soldAt', width: 22 },
    ],
    query: async (lastId) => {
      const [rows] = await db.execute(
        `
        SELECT
          id,
          invoice_id AS invoice,
          CASE
            WHEN source_type = 'Take Out' OR target_id IS NULL THEN 'Take Out'
            ELSE COALESCE(source_type, 'Dine In')
          END AS source,
          COALESCE(NULLIF(payment_method, ''), NULLIF(payment_type, ''), 'Cash') AS payment,
          payment_bank AS bank,
          subtotal,
          tax,
          COALESCE(total, total_amount, 0) AS total,
          status,
          updated_at AS soldAt
        FROM orders
        WHERE ${COMPLETED}${filter.clause} AND id > ?
        ORDER BY id
        LIMIT ${PAGE}
        `,
        [...filter.params, lastId],
      )
      return [rows.map((row) => ({
        ...row,
        subtotal: asNumber(row.subtotal),
        tax: asNumber(row.tax),
        total: asNumber(row.total),
      }))]
    },
  })
}

async function writeExpensesSheet(workbook, db, period) {
  const filter = periodClause(expensePeriod, period)
  await writePagedSheet(workbook, {
    name: 'Expenses',
    columns: [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Description', key: 'description', width: 36 },
      { header: 'Amount', key: 'amount', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Expense date', key: 'expenseDate', width: 16 },
      { header: 'Recorded by', key: 'recordedBy', width: 18 },
      { header: 'Paid from', key: 'paidFrom', width: 12 },
    ],
    query: async (lastId) => {
      const [rows] = await db.execute(
        `
        SELECT id, category, description, amount, expense_date AS expenseDate, created_by_name AS recordedBy, paid_from AS paidFrom
        FROM expenses
        WHERE id > ?${filter.clause}
        ORDER BY id
        LIMIT ${PAGE}
        `,
        [lastId, ...filter.params],
      )
      return [rows.map((row) => ({ ...row, amount: asNumber(row.amount) }))]
    },
  })
}

async function writeStockSheet(workbook, db) {
  await writePagedSheet(workbook, {
    name: 'Stock',
    columns: [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Item', key: 'item', width: 36 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Section', key: 'section', width: 14 },
      { header: 'On hand', key: 'onHand', width: 12, style: { numFmt: '#,##0.000' } },
      { header: 'Max', key: 'maxStock', width: 12, style: { numFmt: '#,##0.000' } },
      { header: 'Unit', key: 'unit', width: 12 },
      { header: 'Low', key: 'low', width: 12, style: { numFmt: '#,##0.000' } },
      { header: 'Very low', key: 'critical', width: 12, style: { numFmt: '#,##0.000' } },
      { header: 'Status', key: 'status', width: 16 },
    ],
    query: async (lastId) => {
      const [rows] = await db.execute(
        `
        SELECT
          id, item_name AS item, category, section,
          stock_quantity AS onHand, max_stock AS maxStock, unit_label AS unit,
          low_threshold AS low, critical_threshold AS critical, stock_status AS status
        FROM inventory
        WHERE id > ?
        ORDER BY id
        LIMIT ${PAGE}
        `,
        [lastId],
      )
      return [rows.map((row) => ({
        ...row,
        onHand: asNumber(row.onHand),
        maxStock: asNumber(row.maxStock),
        low: asNumber(row.low),
        critical: asNumber(row.critical),
      }))]
    },
  })
}

async function writeMovementsSheet(workbook, db, period) {
  const filter = periodClause(movementPeriod, period, 'm')
  try {
    await writePagedSheet(workbook, {
      name: 'Stock Movements',
      columns: [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Item', key: 'item', width: 36 },
        { header: 'Change', key: 'changeAmount', width: 12, style: { numFmt: '#,##0.000' } },
        { header: 'Quantity after', key: 'quantityAfter', width: 16, style: { numFmt: '#,##0.000' } },
        { header: 'Reason', key: 'reason', width: 14 },
        { header: 'Order ID', key: 'orderId', width: 12 },
        { header: 'Note', key: 'note', width: 28 },
        { header: 'Created at', key: 'createdAt', width: 22 },
      ],
      query: async (lastId) => {
        const [rows] = await db.execute(
          `
          SELECT
            m.id,
            i.item_name AS item,
            m.change_amount AS changeAmount,
            m.quantity_after AS quantityAfter,
            m.reason,
            m.order_id AS orderId,
            m.note,
            m.created_at AS createdAt
          FROM stock_movements m
          LEFT JOIN inventory i ON i.id = m.inventory_id
          WHERE m.id > ?${filter.clause}
          ORDER BY m.id
          LIMIT ${PAGE}
          `,
          [lastId, ...filter.params],
        )
        return [rows.map((row) => ({
          ...row,
          changeAmount: asNumber(row.changeAmount),
          quantityAfter: asNumber(row.quantityAfter),
        }))]
      },
    })
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error
    const sheet = workbook.addWorksheet('Stock Movements')
    sheet.columns = [{ header: 'Note', key: 'note', width: 40 }]
    sheet.addRow({ note: 'Stock movement history is not available' }).commit()
    sheet.commit()
  }
}

async function exportBusinessDataFile(db, period, filePath) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
  })
  await writeSalesSheet(workbook, db, period)
  await writeExpensesSheet(workbook, db, period)
  await writeStockSheet(workbook, db)
  await writeMovementsSheet(workbook, db, period)
  await workbook.commit()
}

module.exports = {
  exportBusinessDataFile,
}
