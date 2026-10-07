import { useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from '../services/apiClient'
import { DEFAULT_EXCHANGE_RATE, MAX_EXCHANGE_RATE, MIN_EXCHANGE_RATE } from '../utils/currency'

/**
 * The shop's USD -> KHR rate, owned by the server (admins change it on the dashboard).
 * One value is shared by every screen, so the till, the split bill and the dashboard
 * card can never show different rates. It starts at the default and is replaced as soon
 * as the server answers; offline, the till keeps the last rate it saw.
 */
const MIN_REFETCH_MS = 30 * 1000

let rate = DEFAULT_EXCHANGE_RATE
let lastFetchedAt = 0
let inflight = null
const listeners = new Set()

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return rate
}

export function setSharedExchangeRate(next) {
  const value = Number(next)
  if (!Number.isInteger(value) || value < MIN_EXCHANGE_RATE || value > MAX_EXCHANGE_RATE) return
  if (value === rate) return
  rate = value
  listeners.forEach((listener) => listener())
}

export function refreshExchangeRate({ force = false } = {}) {
  if (inflight) return inflight
  if (!force && Date.now() - lastFetchedAt < MIN_REFETCH_MS) return Promise.resolve(rate)

  inflight = apiFetch('/settings/exchange-rate')
    .then(async (response) => {
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      lastFetchedAt = Date.now()
      setSharedExchangeRate(data.rate)
    })
    .catch(() => {
      // Offline or signed out: keep what we have.
    })
    .finally(() => {
      inflight = null
    })
    .then(() => rate)

  return inflight
}

export function useExchangeRate() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    refreshExchangeRate()
    // A rate changed on another screen is picked up when this tab comes back into view.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshExchangeRate()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return value
}
