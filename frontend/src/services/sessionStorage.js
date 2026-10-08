const SESSION_KEY = 'mlu_kitchen_cafe.session'

const VALID_PAGES = new Set([
  'dashboard',
  'users',
  'order',
  'table',
  'reservations',
  'payment',
  'menu',
  'sales_history',
  'inventory',
  'reports_analysis',
  'backup_recovery',
])

const LEGACY_PAGE_ALIASES = {
  reports: 'reports_analysis',
  reports_prediction: 'reports_analysis',
}

function resolveActivePage(page) {
  const resolved = LEGACY_PAGE_ALIASES[page] ?? page
  return VALID_PAGES.has(resolved) ? resolved : 'dashboard'
}

let startupEvaluated = false

function isPageReload() {
  if (typeof window === 'undefined' || !window.performance) return false
  try {
    const navEntry = window.performance.getEntriesByType?.('navigation')?.[0]
    if (navEntry && typeof navEntry.type === 'string') {
      return navEntry.type === 'reload'
    }
    return window.performance.navigation?.type === 1
  } catch {
    return false
  }
}

function ensureStartupSession() {
  if (startupEvaluated) return
  startupEvaluated = true

  if (typeof window === 'undefined') return

  // 1. Purge legacy localStorage session unconditionally
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore storage clear failures.
  }

  // 2. If this is a fresh launch/open (not an F5 reload), purge sessionStorage so user must log in
  if (!isPageReload()) {
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // Ignore storage clear failures.
    }
  }
}

export function readSession() {
  ensureStartupSession()
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.token || !parsed?.user) return null
    return {
      token: parsed.token,
      user: parsed.user,
      activePage: resolveActivePage(parsed.activePage),
    }
  } catch {
    return null
  }
}

export function writeSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore storage write failures.
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore storage clear failures.
  }
}

const CONNECTION_LOST_KEY = 'mlu_kitchen_cafe.connection_lost'

export function markConnectionLost() {
  try {
    sessionStorage.setItem(CONNECTION_LOST_KEY, '1')
  } catch {
    // Ignore storage write failures.
  }
}

export function consumeConnectionLost() {
  try {
    const flagged = sessionStorage.getItem(CONNECTION_LOST_KEY) === '1'
    if (flagged) sessionStorage.removeItem(CONNECTION_LOST_KEY)
    return flagged
  } catch {
    return false
  }
}

export function formatDisplayName(username) {
  if (!username?.trim()) return 'Staff User'
  const cleaned = username.trim()
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}
