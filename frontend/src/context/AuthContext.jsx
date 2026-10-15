import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  clearSession,
  consumeConnectionLost,
  readSession,
  writeSession,
} from '../services/sessionStorage'
import { writeActiveView, resetActiveViewForLogin } from '../utils/activeViewStorage'
import { apiFetch, SESSION_EXPIRED_EVENT } from '../services/apiClient'
import {
  canAccessView,
  isAdminRole,
  isCashierRole,
  normalizePermissions,
  VALID_PERMISSIONS,
} from '../utils/permissions'

const AuthContext = createContext(null)

function notifySessionChanged() {
  window.dispatchEvent(new CustomEvent('mlu:session-changed'))
}

function normalizeSessionUser(user) {
  if (!user) return null
  return {
    ...user,
    permissions: isAdminRole(user.role)
      ? [...VALID_PERMISSIONS]
      : normalizePermissions(user.permissions),
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession())

  const endLocalSession = useCallback(() => {
    clearSession()
    setSession(null)
    notifySessionChanged()
  }, [])

  const refreshUser = useCallback(async () => {
    const currentSession = readSession()
    if (!currentSession?.token) return null

    try {
      const res = await apiFetch('/auth/me', { token: currentSession.token })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) return null

      const nextUser = normalizeSessionUser(data.user)

      const nextSession = {
        ...currentSession,
        user: nextUser,
      }
      writeSession(nextSession)
      setSession(nextSession)
      notifySessionChanged()
      return nextUser
    } catch {
      return null
    }
  }, [])

  const login = useCallback(async ({ username, password }) => {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: username?.trim(),
        password,
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const retryHeader = Number.parseInt(res.headers.get('Retry-After') || '', 10)
      const retryAfterSeconds = Number(data.retryAfterSeconds)
        || (Number.isFinite(retryHeader) ? retryHeader : 0)
      const error = new Error(
        res.status === 429
          ? 'Too many attempts. Please try again later.'
          : 'Username or password is incorrect.',
      )
      error.status = res.status
      error.retryAfterSeconds = res.status === 429 ? retryAfterSeconds : 0
      throw error
    }

    consumeConnectionLost()

    const nextUser = normalizeSessionUser(data.user)

    const activePage = 'dashboard'
    resetActiveViewForLogin()

    const nextSession = {
      token: data.token,
      user: nextUser,
      activePage,
    }

    writeSession(nextSession)
    setSession(nextSession)
    notifySessionChanged()
  }, [])

  const logout = useCallback(() => {
    const token = readSession()?.token
    if (token) {
      apiFetch('/auth/logout', { method: 'POST', activity: false }).catch(() => {})
    }
    endLocalSession()
  }, [endLocalSession])

  const setActivePage = useCallback((page) => {
    writeActiveView(page)
    setSession((prev) => {
      if (!prev) return prev
      const next = { ...prev, activePage: page }
      writeSession(next)
      return next
    })
  }, [])

  const adoptSession = useCallback((token, user) => {
    const current = readSession()
    const nextUser = {
      ...normalizeSessionUser(user),
      must_change_password: Boolean(user?.must_change_password),
    }
    const nextSession = {
      token,
      user: nextUser,
      activePage: current?.activePage || 'dashboard',
    }
    writeSession(nextSession)
    setSession(nextSession)
    notifySessionChanged()
  }, [])

  const completePasswordChange = useCallback(async ({ currentPassword, password, confirmPassword }) => {
    const res = await apiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, password, confirmPassword }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.message || 'Could not update the password.')
    }
    if (!data.token || !data.user) {
      throw new Error(data.message || 'Could not update the password.')
    }
    // Persist the new session before anything else so a follow-up refresh cannot use the old token.
    adoptSession(data.token, data.user)
    return data
  }, [adoptSession])

  useEffect(() => {
    if (!session?.token) return undefined

    refreshUser()

    const interval = setInterval(() => {
      if (!readSession()?.token) return
      refreshUser()
    }, 30000)
    const handleFocus = () => {
      if (!readSession()?.token) return
      refreshUser()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [session?.token, refreshUser])

  useEffect(() => {
    const onSessionExpired = () => {
      if (!readSession()?.token) return
      endLocalSession()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
  }, [endLocalSession])

  const user = session?.user ?? null

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(session?.token),
      token: session?.token ?? null,
      user,
      isAdmin: isAdminRole(user?.role),
      canCancelOrders: isAdminRole(user?.role) || isCashierRole(user?.role),
      activePage: session?.activePage ?? 'dashboard',
      login,
      logout,
      setActivePage,
      refreshUser,
      adoptSession,
      completePasswordChange,
      canAccess: (viewId) => canAccessView(user, viewId),
    }),
    [session, user, login, logout, setActivePage, refreshUser, adoptSession, completePasswordChange],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
