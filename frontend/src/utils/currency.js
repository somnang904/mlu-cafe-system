/**
 * Currency utilities for Cambodian Riel (KHR) and US Dollar (USD)
 * Standard exchange rate default: 1 USD = 4,100 KHR
 */

export const DEFAULT_EXCHANGE_RATE = 4100

export function formatUsd(amount) {
  const val = Number(amount)
  if (!Number.isFinite(val)) return '$0.00'
  return `$${val.toFixed(2)}`
}

export function formatKhr(amount) {
  const val = Number(amount)
  if (!Number.isFinite(val)) return '0 ៛'
  return `${Math.round(val).toLocaleString()} ៛`
}

export function roundKhrCash(amount) {
  const val = Number(amount)
  if (!Number.isFinite(val)) return 0
  // Round to nearest 100 Riels (smallest common note in Cambodia)
  return Math.round(val / 100) * 100
}

export function usdToKhr(usd, rate = DEFAULT_EXCHANGE_RATE) {
  const val = Number(usd)
  if (!Number.isFinite(val)) return 0
  return roundKhrCash(val * rate)
}

export function khrToUsd(khr, rate = DEFAULT_EXCHANGE_RATE) {
  const val = Number(khr)
  if (!Number.isFinite(val) || rate <= 0) return 0
  return Math.round((val / rate) * 100) / 100
}

export function splitChange(changeUsd, rate = DEFAULT_EXCHANGE_RATE) {
  const change = Math.max(0, Math.round((Number(changeUsd) || 0) * 100) / 100)
  const safeRate = Number(rate) > 0 ? Number(rate) : DEFAULT_EXCHANGE_RATE
  const usd = Math.floor(change + 1e-9)
  return { usd, khr: roundKhrCash((change - usd) * safeRate) }
}

export function calculateCashChange({
  totalDueUsd = 0,
  receivedUsd = 0,
  receivedKhr = 0,
  exchangeRate = DEFAULT_EXCHANGE_RATE,
}) {
  const dueUsd = Math.max(0, Number(totalDueUsd) || 0)
  const recUsd = Math.max(0, Number(receivedUsd) || 0)
  const recKhr = Math.max(0, Number(receivedKhr) || 0)
  const rate = Number(exchangeRate) > 0 ? Number(exchangeRate) : DEFAULT_EXCHANGE_RATE

  const recKhrInUsd = recKhr / rate
  const totalReceivedUsd = recUsd + recKhrInUsd

  const isSufficient = totalReceivedUsd >= dueUsd - 50 / rate - 0.001
  const remainingDueUsd = isSufficient ? 0 : dueUsd - totalReceivedUsd
  const remainingDueKhr = roundKhrCash(remainingDueUsd * rate)

  const changeUsd = isSufficient ? Math.max(0, totalReceivedUsd - dueUsd) : 0
  const changeKhr = roundKhrCash(changeUsd * rate)

  return {
    dueUsd,
    dueKhr: usdToKhr(dueUsd, rate),
    receivedUsd: recUsd,
    receivedKhr: recKhr,
    totalReceivedUsd: Math.round(totalReceivedUsd * 100) / 100,
    isSufficient,
    remainingDueUsd: Math.round(remainingDueUsd * 100) / 100,
    remainingDueKhr,
    changeUsd: Math.round(changeUsd * 100) / 100,
    changeKhr,
    exchangeRate: rate,
  }
}
