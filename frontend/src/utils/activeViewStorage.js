const SESSION_VIEW_KEY = 'mlu_kitchen_cafe_active_view'
// Mirrored in localStorage so a brand-new tab still lands on the last view.
const LOCAL_VIEW_KEY = 'mlu_kitchen_cafe_active_view'

export const VALID_VIEWS = new Set([
  'dashboard',
  'users',
  'order',
  'table',
  'reservations',
  'payment',
  'menu',
  'sales_history',
  'inventory',
  'inventory_stocktake',
  'inventory_ingredients',
  'inventory_expenses',
  'reports_analysis',
  'backup_recovery',
  'security_alerts',
])

const LEGACY_VIEW_ALIASES = {
  reports: 'reports_analysis',
  reports_prediction: 'reports_analysis',
}

const HASH_SEGMENT_ALIASES = {
  'reports-analysis': 'reports_analysis',
  'reports-prediction': 'reports_analysis',
  'sales-history': 'sales_history',
  'backup-recovery': 'backup_recovery',
}

function resolveViewId(raw) {
  if (!raw) return null
  const normalized = String(raw).trim().toLowerCase().replace(/-/g, '_')
  const resolved = LEGACY_VIEW_ALIASES[normalized] ?? normalized
  return VALID_VIEWS.has(resolved) ? resolved : null
}

function readViewFromHash() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (!hash) return null
  const segment = hash.split(/[?#]/)[0]
  const underscored = HASH_SEGMENT_ALIASES[segment] ?? segment.replace(/-/g, '_')
  return resolveViewId(underscored)
}

function writeViewHash(view) {
  if (typeof window === 'undefined') return
  const slug = view.replace(/_/g, '-')
  const nextHash = `#/${slug}`
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`)
  }
}

export function readActiveView() {
  try {
    if (typeof window !== 'undefined') {
      const fromSession = sessionStorage.getItem(SESSION_VIEW_KEY)
      const resolvedSession = resolveViewId(fromSession)
      if (resolvedSession) {
        if (fromSession !== resolvedSession) writeActiveView(resolvedSession)
        return resolvedSession
      }

      const fromHash = readViewFromHash()
      if (fromHash) {
        writeActiveView(fromHash)
        return fromHash
      }

      const fromLocal = localStorage.getItem(LOCAL_VIEW_KEY)
      const resolvedLocal = resolveViewId(fromLocal)
      if (resolvedLocal) {
        writeActiveView(resolvedLocal)
        return resolvedLocal
      }

      const sessionRaw = localStorage.getItem('mlu_kitchen_cafe.session')
      if (sessionRaw) {
        const parsed = JSON.parse(sessionRaw)
        const resolved = resolveViewId(parsed?.activePage)
        if (resolved) {
          writeActiveView(resolved)
          return resolved
        }
      }
    }
  } catch {
    // Ignore storage read failures.
  }
  return 'dashboard'
}

export function writeActiveView(view) {
  const resolved = resolveViewId(view)
  if (!resolved) return
  try {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_VIEW_KEY, resolved)
      localStorage.setItem(LOCAL_VIEW_KEY, resolved)
      writeViewHash(resolved)
    }
  } catch {
    // Ignore storage write failures.
  }
}

/** Call on successful login / re-login so staff always land on dashboard. */
export function resetActiveViewForLogin() {
  writeActiveView('dashboard')
}
