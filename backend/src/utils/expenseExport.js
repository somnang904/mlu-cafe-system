const ExcelJS = require('exceljs')
const { actorLabel, formatMoney, parseReportRange, pdfSafe, roundMoney } = require('./exportParams')
const { drawDocumentHeader, drawNote, drawSectionTitle, drawTable, renderPdf } = require('./pdfLayout')
const { EXPENSE_METHODS, EXPENSE_STATUSES, listExpenses } = require('./expenses')

// English labels for the file (exports are always in English).
const METHOD_LABELS = { cash: 'Cash', aba_khqr: 'ABA/KHQR', card: 'Card', bank_transfer: 'Bank transfer' }
const STATUS_LABELS = { paid: 'Paid', unpaid: 'Unpaid' }

const ALL_TIME = { scope: 'all', label: 'All time', fileKey: 'All-Time', startDate: null, endDate: null }

/** Same filters as the Expenses page: period (from/to, or period=all), category, method, status and the search box. */
function parseExpenseFilters(query = {}) {
  const period = query.period === 'all' && query.from == null && query.to == null
    ? ALL_TIME
    : parseReportRange(query.from, query.to)
  const categoryId = Number.parseInt(query.category_id, 10)
  const method = EXPENSE_METHODS.includes(query.method) ? query.method : null
  const status = EXPENSE_STATUSES.includes(query.status) ? query.status : null
  const search = String(query.search ?? '').trim().toLowerCase().slice(0, 100)
  return { period, categoryId: Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null, method, status, search }
}

function matchesSearch(expense, search) {
  if (!search) return true
  return [expense.title, expense.vendor, expense.note, expense.category, expense.amount.toFixed(2)]
    .some((value) => String(value || '').toLowerCase().includes(search))
}

async function loadFilteredExpenses(db, filters) {
  const rows = await listExpenses(db, filters.period.startDate
    ? { from: filters.period.startDate, toExclusive: filters.period.endDate, status: filters.status }
    : { days: 'all', status: filters.status })
  return rows.filter((expense) => (
    (!filters.categoryId || expense.category_id === filters.categoryId)
    && (!filters.method || expense.method === filters.method)
    && matchesSearch(expense, filters.search)
  ))
}

function describe(expense) {
  return [expense.title, expense.vendor, expense.note].filter(Boolean).join(' - ') || expense.category
}

function totals(expenses) {
  const sum = (list) => roundMoney(list.reduce((total, expense) => total + expense.amount, 0))
  const unpaid = expenses.filter((expense) => expense.status === 'unpaid')
  return { total: sum(expenses), paid: sum(expenses.filter((expense) => expense.status === 'paid')), unpaid: sum(unpaid), unpaidCount: unpaid.length }
}

function byCategory(expenses) {
  const map = new Map()
  for (const expense of expenses) map.set(expense.category, roundMoney((map.get(expense.category) || 0) + expense.amount))
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function filterNote(filters, categoryName) {
  const parts = []
  if (categoryName) parts.push(`category ${categoryName}`)
  if (filters.method) parts.push(`method ${METHOD_LABELS[filters.method]}`)
  if (filters.status) parts.push(STATUS_LABELS[filters.status].toLowerCase() + ' only')
  if (filters.search) parts.push(`matching "${filters.search}"`)
  return parts.length ? `Filtered: ${parts.join(', ')}.` : 'All categories, methods and statuses.'
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FF064E3B' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
}

async function buildExpenseWorkbook(expenses, filters, categoryName) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Mlu Kitchen & Cafe Siem Reap'
  const sheet = workbook.addWorksheet('Expenses')
  sheet.addRow([`Expenses - ${filters.period.label}`]).font = { bold: true, size: 13 }
  sheet.addRow([filterNote(filters, categoryName)])
  sheet.addRow([])
  styleHeader(sheet.addRow(['Date', 'Title', 'Vendor', 'Note', 'Category', 'Method', 'Status', 'Amount', 'Riel (as entered)', 'Receipt', 'Repeats monthly']))
  for (const expense of expenses) {
    const row = sheet.addRow([
      expense.expense_date,
      expense.title,
      expense.vendor,
      expense.note,
      expense.category,
      METHOD_LABELS[expense.method],
      STATUS_LABELS[expense.status],
      expense.amount,
      expense.currency === 'KHR' ? expense.amount_khr : null,
      expense.has_receipt ? 'Yes' : 'No',
      expense.is_recurring ? 'Yes' : 'No',
    ])
    row.getCell(8).numFmt = '$#,##0.00'
    row.getCell(9).numFmt = '#,##0 "KHR"'
  }
  const sum = totals(expenses)
  sheet.addRow([])
  for (const [label, value] of [['Total', sum.total], ['Paid', sum.paid], ['Unpaid', sum.unpaid]]) {
    const row = sheet.addRow(['', '', '', '', '', '', label, value])
    row.font = { bold: true }
    row.getCell(8).numFmt = '$#,##0.00'
  }
  const widths = [12, 26, 22, 30, 16, 14, 10, 12, 16, 9, 15]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })

  const categories = workbook.addWorksheet('By category')
  styleHeader(categories.addRow(['Category', 'Amount', 'Share']))
  for (const [category, amount] of byCategory(expenses)) {
    const row = categories.addRow([category, amount, sum.total ? amount / sum.total : 0])
    row.getCell(2).numFmt = '$#,##0.00'
    row.getCell(3).numFmt = '0.0%'
  }
  categories.getColumn(1).width = 22
  categories.getColumn(2).width = 14
  categories.getColumn(3).width = 10
  return workbook.xlsx.writeBuffer()
}

function buildExpensePdfBuffer(expenses, filters, categoryName, generatedBy) {
  return renderPdf((doc) => {
    doc.info.Title = 'Expenses'
    doc.info.Author = generatedBy
    let y = drawDocumentHeader(doc, { title: 'Expenses', periodLabel: filters.period.label, generatedBy })
    y = drawNote(doc, y, pdfSafe(filterNote(filters, categoryName)))

    const sum = totals(expenses)
    y = drawSectionTitle(doc, y, 'Summary')
    y = drawTable(
      doc,
      y,
      [{ label: 'Metric', width: 220 }, { label: 'Value', width: 140, align: 'right' }],
      [
        { values: ['Total', formatMoney(sum.total)] },
        { values: ['Paid', formatMoney(sum.paid)] },
        { values: [`Unpaid (${sum.unpaidCount})`, formatMoney(sum.unpaid)] },
        { values: ['Expenses', String(expenses.length)] },
      ],
    )

    const categories = byCategory(expenses)
    if (categories.length) {
      y = drawSectionTitle(doc, y, 'By category')
      y = drawTable(
        doc,
        y,
        [{ label: 'Category', width: 220 }, { label: 'Amount', width: 100, align: 'right' }, { label: 'Share', width: 60, align: 'right' }],
        categories.map(([category, amount]) => ({
          values: [pdfSafe(category), formatMoney(amount), `${sum.total ? ((amount / sum.total) * 100).toFixed(1) : '0.0'}%`],
        })),
      )
    }

    y = drawSectionTitle(doc, y, 'Expenses')
    drawTable(
      doc,
      y,
      [
        { label: 'Date', width: 62 },
        { label: 'Description', width: 170 },
        { label: 'Category', width: 80 },
        { label: 'Method', width: 66 },
        { label: 'Status', width: 46 },
        { label: 'Amount', width: 66, align: 'right' },
      ],
      expenses.map((expense) => ({
        values: [
          expense.expense_date,
          pdfSafe(describe(expense)) + (expense.is_recurring ? ' (monthly)' : ''),
          pdfSafe(expense.category),
          METHOD_LABELS[expense.method],
          STATUS_LABELS[expense.status],
          formatMoney(expense.amount),
        ],
      })),
    )
  })
}

async function createExpenseExport(db, query, user, kind) {
  const filters = parseExpenseFilters(query)
  const expenses = await loadFilteredExpenses(db, filters)
  const categoryName = filters.categoryId
    ? (expenses[0]?.category || (await db.execute('SELECT name FROM expense_categories WHERE id = ?', [filters.categoryId]))[0][0]?.name || null)
    : null
  const base = `Mlu_Expenses_${filters.period.fileKey}`
  if (kind === 'xlsx') {
    return {
      buffer: Buffer.from(await buildExpenseWorkbook(expenses, filters, categoryName)),
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      periodLabel: filters.period.label,
      count: expenses.length,
    }
  }
  return {
    buffer: await buildExpensePdfBuffer(expenses, filters, categoryName, actorLabel(user)),
    filename: `${base}.pdf`,
    contentType: 'application/pdf',
    periodLabel: filters.period.label,
    count: expenses.length,
  }
}

module.exports = {
  createExpenseExport,
  buildExpenseWorkbook,
  buildExpensePdfBuffer,
  parseExpenseFilters,
}
