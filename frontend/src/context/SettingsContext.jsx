import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { readSession } from '../services/sessionStorage'

const STORAGE_KEY_PREFIX = 'mlu_kitchen_cafe-app-settings'
const LEGACY_STORAGE_KEY = 'mlu_kitchen_cafe-app-settings'

const DEFAULT_SETTINGS = {
  lowStockAlertsEnabled: true,
  loginAlertsEnabled: true,
}

function settingsStorageKey(userId) {
  return userId ? `${STORAGE_KEY_PREFIX}:u${userId}` : LEGACY_STORAGE_KEY
}

function parseSettings(raw) {
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(raw)
    return {
      lowStockAlertsEnabled: parsed.lowStockAlertsEnabled !== false,
      loginAlertsEnabled: parsed.loginAlertsEnabled !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function readStoredSettings(userId) {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  const keyed = localStorage.getItem(settingsStorageKey(userId))
  if (keyed) return parseSettings(keyed)
  if (userId) {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) return parseSettings(legacy)
  }
  return { ...DEFAULT_SETTINGS }
}

function persistSettings(userId, settings) {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify({
    lowStockAlertsEnabled: settings.lowStockAlertsEnabled !== false,
    loginAlertsEnabled: settings.loginAlertsEnabled !== false,
  })
  localStorage.setItem(settingsStorageKey(userId), payload)
  localStorage.setItem(LEGACY_STORAGE_KEY, payload)
}

function currentUserId() {
  return readSession()?.user?.id ?? null
}

const initialSettings = readStoredSettings(currentUserId())

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(initialSettings)
  const [boundUserId, setBoundUserId] = useState(() => currentUserId())

  const { lowStockAlertsEnabled, loginAlertsEnabled } = settings

  useEffect(() => {
    const syncUser = () => {
      const nextId = currentUserId()
      setBoundUserId((prev) => {
        if (prev === nextId) return prev
        setSettings(readStoredSettings(nextId))
        return nextId
      })
    }
    window.addEventListener('storage', syncUser)
    window.addEventListener('mlu:session-changed', syncUser)
    const interval = window.setInterval(syncUser, 1500)
    return () => {
      window.removeEventListener('storage', syncUser)
      window.removeEventListener('mlu:session-changed', syncUser)
      window.clearInterval(interval)
    }
  }, [])

  // Settings belong to a signed-in user; the login screen only reads them.
  useEffect(() => {
    if (!boundUserId) return
    persistSettings(boundUserId, settings)
  }, [settings, boundUserId])

  const setLowStockAlertsEnabled = useCallback((value) => {
    setSettings((prev) => ({ ...prev, lowStockAlertsEnabled: Boolean(value) }))
  }, [])

  const setLoginAlertsEnabled = useCallback((value) => {
    setSettings((prev) => ({ ...prev, loginAlertsEnabled: Boolean(value) }))
  }, [])

  const value = useMemo(
    () => ({
      lowStockAlertsEnabled,
      setLowStockAlertsEnabled,
      loginAlertsEnabled,
      setLoginAlertsEnabled,
    }),
    [lowStockAlertsEnabled, setLowStockAlertsEnabled, loginAlertsEnabled, setLoginAlertsEnabled],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}

export default SettingsProvider
