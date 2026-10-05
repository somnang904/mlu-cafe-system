const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const REPORT_SECTIONS = ['income', 'expenses', 'profit', 'orders', 'monthly', 'spending']

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function parseReportMonth(raw) {
  const value = String(raw ?? '').trim()
  if (value === 'all') {
    return {
      scope: 'all',
      label: 'All months in range',
      fileKey: 'All-Time',
    }
  }

  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) {
    throw invalid('Invalid month. Use YYYY-MM or all.')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    throw invalid('Invalid month. Use YYYY-MM or all.')
  }

  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  return {
    scope: 'month',
    month,
    year,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    fileKey: `${year}-${String(month).padStart(2, '0')}`,
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

function parseReportSections(raw) {
  const parts = String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const unique = []
  for (const part of parts) {
    if (!REPORT_SECTIONS.includes(part)) {
      throw invalid('Invalid report section.')
    }
    if (!unique.includes(part)) unique.push(part)
  }
  if (!unique.length) {
    throw invalid('Select at least one report section.')
  }
  return REPORT_SECTIONS.filter((section) => unique.includes(section))
}

function salesPdfFilename(period) {
  if (period.scope === 'month') {
    return `Mlu_Sales_${period.year}-${String(period.month).padStart(2, '0')}.pdf`
  }
  return 'Mlu_Sales_All-Time.pdf'
}

function reportFilename(period, extension) {
  const key = period.fileKey || (period.scope === 'month'
    ? `${period.year}-${String(period.month).padStart(2, '0')}`
    : 'All-Time')
  return `Mlu_Report_${key}.${extension}`
}

function pdfSafe(value) {
  const cleaned = String(value ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  return cleaned || '-'
}

function roundMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100) / 100
}

function formatMoney(value) {
  const amount = roundMoney(value)
  const text = `$${Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  return amount < 0 ? `-${text}` : text
}

function formatGeneratedAt(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`
}

function actorLabel(user) {
  const username = String(user?.username || '').replace(/[^\x20-\x7E]/g, '').trim()
  if (username) return username
  if (user?.id) return `user ${user.id}`
  return 'unknown'
}

module.exports = {
  REPORT_SECTIONS,
  parseReportMonth,
  parseReportSections,
  salesPdfFilename,
  reportFilename,
  pdfSafe,
  roundMoney,
  formatMoney,
  formatGeneratedAt,
  actorLabel,
}
