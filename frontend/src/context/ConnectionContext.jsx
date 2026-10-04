import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, BACKEND_STATUS_EVENT, getAuthToken } from '../services/apiClient'

const ConnectionContext = createContext({
  backendReachable: true,
  internetOnline: true,
})

export function ConnectionProvider({ children }) {
  const [backendReachable, setBackendReachable] = useState(true)
  const [internetOnline, setInternetOnline] = useState(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  )

  useEffect(() => {
    const onStatus = (event) => {
      const reachable = event.detail?.reachable
      if (typeof reachable === 'boolean') setBackendReachable(reachable)
    }
    const onOnline = () => setInternetOnline(true)
    const onOffline = () => setInternetOnline(false)
    window.addEventListener(BACKEND_STATUS_EVENT, onStatus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener(BACKEND_STATUS_EVENT, onStatus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      if (!getAuthToken()) return
      try {
        // /health sits outside the API rate limiter, so this 8s probe never uses up the quota.
        await apiFetch('/health')
        if (!cancelled) setBackendReachable(true)
      } catch {
        if (!cancelled) setBackendReachable(false)
      }
    }
    probe()
    const timer = window.setInterval(probe, 8000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const value = useMemo(
    () => ({ backendReachable, internetOnline }),
    [backendReachable, internetOnline],
  )

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection() {
  return useContext(ConnectionContext)
}
