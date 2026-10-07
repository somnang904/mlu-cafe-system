export const PERMISSION_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'order', label: 'Order' },
  { id: 'table', label: 'Table' },
  { id: 'reservations', label: 'Reservations' },
  { id: 'payment', label: 'Payment' },
  { id: 'menu', label: 'Menu Management' },
  { id: 'settings', label: 'Settings' },
  { id: 'backup_recovery', label: 'Data Management' },
  { id: 'sales_history', label: 'Sales' },
  { id: 'inventory_stock', label: 'Stock' },
  { id: 'reports', label: 'Reports' },
]

export const VALID_PERMISSIONS = PERMISSION_OPTIONS.map((option) => option.id)

const PERMISSION_ALIASES = {
  inventory: 'inventory_stock',
  reports_analysis: 'reports',
}

export const CASHIER_DEFAULT_PERMISSIONS = [
  'order',
  'table',
  'payment',
  'reservations',
  'sales_history',
]

export const STAFF_DEFAULT_PERMISSIONS = [
  'order',
  'table',
  'reservations',
]

export const VIEW_PERMISSION_MAP = {
  dashboard: 'dashboard',
  order: 'order',
  table: 'table',
  reservations: ['reservations', 'table'],
  payment: 'payment',
  menu: 'menu',
  sales_history: 'sales_history',
  inventory: 'inventory_stock',
  inventory_stocktake: 'inventory_stock',
  // Stock users log expenses; Reports users also see, edit and delete them (same as the API).
  inventory_expenses: ['inventory_stock', 'reports'],
  reports_analysis: 'reports',
  backup_recovery: 'backup_recovery',
}

export function isAdminRole(role) {
  return String(role || '').toLowerCase() === 'admin'
}

export function isCashierRole(role) {
  const value = String(role || '').toLowerCase()
  return value === 'cashier' || value === 'supervisor'
}

export function isStaffRole(role) {
  return String(role || '').toLowerCase() === 'staff'
}

export function parsePermissions(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function resolvePermissionKey(permission) {
  const key = String(permission || '').trim().toLowerCase()
  if (!key) return null
  return PERMISSION_ALIASES[key] || key
}

export function normalizePermissions(rawPermissions) {
  const allowed = new Set(VALID_PERMISSIONS)
  const normalized = new Set()

  for (const permission of parsePermissions(rawPermissions)) {
    const resolved = resolvePermissionKey(permission)
    if (resolved && allowed.has(resolved)) {
      normalized.add(resolved)
    }
  }

  return [...normalized]
}

/** @deprecated Use normalizePermissions */
export function permissionsWithinCeiling(role, rawPermissions) {
  if (isAdminRole(role)) return [...VALID_PERMISSIONS]
  return normalizePermissions(rawPermissions)
}

export function permissionOptionsForRole() {
  return PERMISSION_OPTIONS
}

export function defaultPermissionsForRole(role) {
  if (isAdminRole(role)) return [...VALID_PERMISSIONS]
  if (isCashierRole(role)) return [...CASHIER_DEFAULT_PERMISSIONS]
  if (isStaffRole(role)) return [...STAFF_DEFAULT_PERMISSIONS]
  return []
}

export function userHasPermission(user, permissionId) {
  if (!user) return false
  if (isAdminRole(user.role)) return true
  const resolved = resolvePermissionKey(permissionId)
  if (!resolved) return false
  return normalizePermissions(user.permissions).includes(resolved)
}

function viewRequiresAnyPermission(user, requiredPermissions) {
  const keys = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions]
  return keys.some((permissionId) => userHasPermission(user, permissionId))
}

export function canAccessView(user, viewId) {
  if (!user) return false
  if (viewId === 'users' || viewId === 'security_alerts') return isAdminRole(user.role)

  const requiredPermission = VIEW_PERMISSION_MAP[viewId]
  if (!requiredPermission) return false
  return viewRequiresAnyPermission(user, requiredPermission)
}

export function canSeeNavItem(user, item) {
  if (!user || !item) return false
  if (item.adminOnly) return isAdminRole(user.role)
  const allowed = new Set((item.roles || []).map((role) => String(role).toLowerCase()))
  const role = String(user.role || '').trim().toLowerCase()
  // Treat legacy Supervisor as Cashier for nav role lists.
  const roleAliases = role === 'supervisor' ? ['supervisor', 'cashier'] : [role]
  if (![...allowed].some((entry) => roleAliases.includes(entry))) return false
  return canAccessView(user, item.id)
}

export function getAccessibleViews(user) {
  const views = [...Object.keys(VIEW_PERMISSION_MAP), 'users', 'security_alerts']
  return [...new Set(views)].filter((viewId) => canAccessView(user, viewId))
}

export function getDefaultViewForUser(user) {
  if (canAccessView(user, 'dashboard')) return 'dashboard'
  const accessible = getAccessibleViews(user)
  return accessible[0] || 'order'
}

export function getPermissionLabel(permissionId) {
  return PERMISSION_OPTIONS.find((option) => option.id === permissionId)?.label || permissionId
}
