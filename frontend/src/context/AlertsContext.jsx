import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, getAuthToken } from '../services/apiClient'
import { filterAlertsBySettings, countAlerts } from '../utils/alertSettings'
import { useSettings } from './SettingsContext'
import { useNotifications } from './NotificationContext'
import { playAlertSound } from '../utils/soundAlert'

const AlertsContext = createContext(null)
/** Visible-tab poll — keep stock / expense / reservation notices fresh online. */
const POLL_INTERVAL_MS = 20_000
/** Background tabs are throttled by browsers; use a slower cadence when hidden. */
const HIDDEN_POLL_INTERVAL_MS = 60_000

export function AlertsProvider({ children }) {
  const { lowStockAlertsEnabled, loginAlertsEnabled } = useSettings()
  const { pushBanner } = useNotifications()
  const [alerts, setAlerts] = useState([])
  const [rawCounts, setRawCounts] = useState({
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
  })
  const [generatedAt, setGeneratedAt] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const inFlightRef = useRef(false)
  const knownAlertKeysRef = useRef(null)

  const fetchAlerts = useCallback(async ({ refresh = false } = {}) => {
    const token = getAuthToken()
    if (!token) {
      setIsLoading(false)
      setAlerts([])
      setRawCounts({ total: 0, critical: 0, warning: 0, info: 0 })
      return null
    }

    if (inFlightRef.current && !refresh) return null
    inFlightRef.current = true

    try {
      const path = refresh ? '/alerts?refresh=1' : '/alerts'
      const response = await apiFetch(path, { token })
      if (response.status === 401 || response.status === 403) {
        setError(null)
        setAlerts([])
        setRawCounts({ total: 0, critical: 0, warning: 0, info: 0 })
        return null
      }
      if (!response.ok) {
        setError('unavailable')
        setAlerts([])
        setRawCounts({ total: 0, critical: 0, warning: 0, info: 0 })
        return null
      }
      const data = await response.json()
      const incomingAlerts = Array.isArray(data.alerts) ? data.alerts : []
      setAlerts(incomingAlerts)
      setRawCounts(data.counts || { total: 0, critical: 0, warning: 0, info: 0 })
      setGeneratedAt(data.generatedAt || null)
      setError(null)

      // Alert detection: chime & banner for newly arrived alerts
      const alertKey = (a) => `${a.id}:${a.severity || 'warning'}`
      if (knownAlertKeysRef.current === null) {
        // Initial fetch on app start: memorize existing alerts silently
        knownAlertKeysRef.current = new Set(incomingAlerts.map(alertKey))
      } else {
        const prevKeys = knownAlertKeysRef.current
        const newItems = incomingAlerts.filter((a) => !prevKeys.has(alertKey(a)))
        if (newItems.length > 0) {
          const hasCritical = newItems.some((a) => a.severity === 'critical')
          playAlertSound(hasCritical ? 'critical' : 'warning')

          newItems.slice(0, 2).forEach((alert) => {
            pushBanner?.({
              tone: alert.severity === 'critical' ? 'critical' : 'warning',
              title: alert.title || 'ការជូនដំណឹង (Alert)',
              message: alert.message || '',
              durationMs: 7000,
            })
          })
        }
        knownAlertKeysRef.current = new Set(incomingAlerts.map(alertKey))
      }

      return data
    } catch {
      setError('unavailable')
      setAlerts([])
      setRawCounts({ total: 0, critical: 0, warning: 0, info: 0 })
      return null
    } finally {
      inFlightRef.current = false
      setIsLoading(false)
    }
  }, [pushBanner])

  const markNotificationRead = useCallback(async (alert) => {
    const notificationId = alert?.notificationId
    if (!notificationId) return false
    try {
      const response = await apiFetch(`/notifications/${notificationId}/read`, { method: 'PATCH' })
      if (!response.ok) return false
      await fetchAlerts({ refresh: true })
      return true
    } catch {
      return false
    }
  }, [fetchAlerts])

  const markAllNotificationsRead = useCallback(async () => {
    try {
      const response = await apiFetch('/notifications/read-all', { method: 'POST' })
      if (!response.ok) return false
      await fetchAlerts({ refresh: true })
      return true
    } catch {
      return false
    }
  }, [fetchAlerts])

  useEffect(() => {
    if (!getAuthToken()) {
      setIsLoading(false)
      return undefined
    }

    let cancelled = false
    let timerId = null

    const run = (refresh = false) => {
      if (cancelled || !getAuthToken()) return
      fetchAlerts({ refresh })
    }

    const schedule = () => {
      if (timerId != null) window.clearInterval(timerId)
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      const ms = hidden ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS
      timerId = window.setInterval(() => {
        if (!getAuthToken()) return
        // Skip background work when offline — resume on `online`.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return
        run(false)
      }, ms)
    }

    run(true)
    schedule()

    const onVisibleOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule()
        return
      }
      schedule()
      run(true)
    }

    const onOnline = () => run(true)

    document.addEventListener('visibilitychange', onVisibleOrFocus)
    window.addEventListener('focus', onVisibleOrFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onVisibleOrFocus)

    return () => {
      cancelled = true
      if (timerId != null) window.clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisibleOrFocus)
      window.removeEventListener('focus', onVisibleOrFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onVisibleOrFocus)
    }
  }, [fetchAlerts])

  const settingsSnapshot = useMemo(
    () => ({ lowStockAlertsEnabled, loginAlertsEnabled }),
    [lowStockAlertsEnabled, loginAlertsEnabled],
  )

  const visibleAlerts = useMemo(() => {
    const list = filterAlertsBySettings(alerts, settingsSnapshot)
    return [...list].sort((a, b) => {
      const timeA = new Date(a.timestamp || a.created_at || 0).getTime()
      const timeB = new Date(b.timestamp || b.created_at || 0).getTime()
      if (timeB !== timeA) return timeB - timeA
      const rank = (s) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2)
      return rank(a.severity) - rank(b.severity)
    })
  }, [alerts, settingsSnapshot])

  const counts = useMemo(() => countAlerts(visibleAlerts), [visibleAlerts])

  const refresh = useCallback(() => fetchAlerts({ refresh: true }), [fetchAlerts])

  const value = useMemo(
    () => ({
      alerts: visibleAlerts,
      allAlerts: alerts,
      counts,
      rawCounts,
      badgeCount: counts.total ?? visibleAlerts.length,
      generatedAt,
      isLoading,
      error,
      refresh,
      refetch: fetchAlerts,
      markNotificationRead,
      markAllNotificationsRead,
      lowStockAlertsEnabled,
      loginAlertsEnabled,
    }),
    [
      visibleAlerts,
      alerts,
      counts,
      rawCounts,
      generatedAt,
      isLoading,
      error,
      refresh,
      fetchAlerts,
      markNotificationRead,
      markAllNotificationsRead,
      lowStockAlertsEnabled,
      loginAlertsEnabled,
    ],
  )

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
}

export function useAlerts() {
  const context = useContext(AlertsContext)
  if (!context) {
    throw new Error('useAlerts must be used within an AlertsProvider')
  }
  return context
}

export default AlertsProvider
