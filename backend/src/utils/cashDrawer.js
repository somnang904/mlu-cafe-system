const DEFAULT_EXCHANGE_RATE = 4100
const MIN_EXCHANGE_RATE = 1000
const MAX_EXCHANGE_RATE = 10000
const KHR_ROUNDING_SLACK = 50
const USD_SLACK = 0.01
const MAX_RECEIVED_USD = 99999999
const MAX_RECEIVED_KHR = 999999999999

function roundUsd(value) {
  return Math.round(Number(value) * 100) / 100
}

function roundKhrCash(value) {
  return Math.round(Number(value) / 100) * 100
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function parseOptionalAmount(value, label) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw badRequest(`${label} must be a number`)
  if (number < 0) throw badRequest(`${label} cannot be negative`)
  return number
}

function resolveExchangeRate(value) {
  const rate = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(rate)) {
    return DEFAULT_EXCHANGE_RATE
  }
  return rate
}

function splitChange(changeUsd, exchangeRate = DEFAULT_EXCHANGE_RATE) {
  const change = Math.max(0, roundUsd(changeUsd) || 0)
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : DEFAULT_EXCHANGE_RATE
  const usd = Math.floor(change + 1e-9)
  const khr = roundKhrCash((change - usd) * rate)
  return { usd, khr }
}

function normalizeCheckoutPayment({
  method,
  totalUsd,
  receivedUsd,
  receivedKhr,
  changeUsd,
  exchangeRate,
}) {
  const total = roundUsd(totalUsd) || 0
  const rate = resolveExchangeRate(exchangeRate)
  if (rate < MIN_EXCHANGE_RATE || rate > MAX_EXCHANGE_RATE) {
    throw badRequest(`exchange_rate must be between ${MIN_EXCHANGE_RATE} and ${MAX_EXCHANGE_RATE} riel per dollar`)
  }

  if (method !== 'Cash') {
    return { received_usd: null, received_khr: null, change_usd: null, change_khr: null, exchange_rate: rate }
  }

  let recUsd = parseOptionalAmount(receivedUsd, 'received_usd')
  let recKhr = parseOptionalAmount(receivedKhr, 'received_khr')
  const claimedChange = parseOptionalAmount(changeUsd, 'change_usd')

  if (recUsd > MAX_RECEIVED_USD || recKhr > MAX_RECEIVED_KHR) {
    throw badRequest('Received amount is too large')
  }

  if (!recUsd && !recKhr) {
    recUsd = total
    recKhr = 0
  }
  recUsd = roundUsd(recUsd || 0)
  recKhr = Math.round(recKhr || 0)

  const receivedTotalUsd = recUsd + recKhr / rate
  const shortfallUsd = total - receivedTotalUsd
  if (shortfallUsd > KHR_ROUNDING_SLACK / rate + USD_SLACK) {
    throw badRequest(
      `Cash received ($${receivedTotalUsd.toFixed(2)}) does not cover the bill total ($${total.toFixed(2)})`,
    )
  }

  const change = Math.max(0, roundUsd(receivedTotalUsd - total))
  if (claimedChange !== null && Math.abs(claimedChange - change) > USD_SLACK + 1e-9) {
    throw badRequest(
      `Change does not match the bill: expected $${change.toFixed(2)}, got $${claimedChange.toFixed(2)}. Refresh the bill and try again.`,
    )
  }

  return {
    received_usd: recUsd,
    received_khr: recKhr,
    change_usd: change,
    change_khr: roundKhrCash(change * rate),
    exchange_rate: rate,
  }
}

function cashDrawerDelta(order) {
  const total = Number(order.total) || 0
  const recUsd = order.received_usd == null ? null : Number(order.received_usd)
  const recKhr = order.received_khr == null ? null : Number(order.received_khr)

  if (!recUsd && !recKhr) return { usd: roundUsd(total), khr: 0 }

  const rate = resolveExchangeRate(order.exchange_rate)
  const changeUsd = order.change_usd == null
    ? Math.max(0, roundUsd((recUsd || 0) + (recKhr || 0) / rate - total))
    : Number(order.change_usd)
  const change = splitChange(changeUsd, rate)
  return {
    usd: roundUsd((recUsd || 0) - change.usd),
    khr: Math.round((recKhr || 0) - change.khr),
  }
}

function summarizeCashOrders(orders) {
  let salesUsd = 0
  let netUsd = 0
  let netKhr = 0
  let exchangeRate = null
  for (const order of orders) {
    const delta = cashDrawerDelta(order)
    salesUsd += Number(order.total) || 0
    netUsd += delta.usd
    netKhr += delta.khr
    if (order.exchange_rate != null && Number(order.exchange_rate) > 0) {
      exchangeRate = Number(order.exchange_rate)
    }
  }
  return {
    salesUsd: roundUsd(salesUsd),
    netUsd: roundUsd(netUsd),
    netKhr: Math.round(netKhr),
    exchangeRate: exchangeRate || DEFAULT_EXCHANGE_RATE,
  }
}

function computeCashDifference({ expectedUsd, expectedKhr, countedUsd, countedKhr, exchangeRate }) {
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : DEFAULT_EXCHANGE_RATE
  const usd = roundUsd(Number(countedUsd) - Number(expectedUsd))
  const khr = Math.round(Number(countedKhr) - Number(expectedKhr))
  return { usd, khr, totalUsd: roundUsd(usd + khr / rate) }
}

module.exports = {
  DEFAULT_EXCHANGE_RATE,
  splitChange,
  normalizeCheckoutPayment,
  cashDrawerDelta,
  summarizeCashOrders,
  computeCashDifference,
}
