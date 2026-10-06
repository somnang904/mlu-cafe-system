const ALLOWED_ROLES = ['Admin', 'Cashier', 'Staff']
/** Roles that may be assigned when creating or editing users through the API/UI. */
const ASSIGNABLE_ROLES = ['Cashier']

function normalizeAllowedRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (value === 'admin') return 'Admin'
  if (value === 'cashier' || value === 'supervisor') return 'Cashier'
  if (value === 'staff') return 'Staff'
  return null
}

function isAssignableRole(role) {
  const normalized = normalizeAllowedRole(role)
  return Boolean(normalized && ASSIGNABLE_ROLES.includes(normalized))
}

/** Rejects Admin, Supervisor (as create target), and unknown roles for create / promote. */
function assignableRoleError(role) {
  const raw = String(role || '').trim().toLowerCase()
  if (raw === 'supervisor') {
    return 'Role must be Cashier.'
  }
  const normalized = normalizeAllowedRole(role)
  if (!normalized || !ASSIGNABLE_ROLES.includes(normalized)) {
    return 'Role must be Cashier.'
  }
  if (normalized === 'Admin') {
    return 'This system has exactly one Admin account. New users must be Cashier.'
  }
  return null
}

function passwordPolicyError(password) {
  const value = String(password ?? '')
  const longEnough = value.length >= 8
  const hasLetter = /[A-Za-z]/.test(value)
  const hasNumber = /[0-9]/.test(value)
  if (longEnough && hasLetter && hasNumber) return null
  return 'Password must be at least 8 characters and include at least one letter and one number.'
}

module.exports = {
  ALLOWED_ROLES,
  ASSIGNABLE_ROLES,
  normalizeAllowedRole,
  isAssignableRole,
  assignableRoleError,
  passwordPolicyError,
}
