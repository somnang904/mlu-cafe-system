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

export function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
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
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
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
