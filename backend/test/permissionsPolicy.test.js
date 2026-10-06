const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  VALID_PERMISSIONS,
  assertPermissionsForSave,
  normalizePermissions,
  userHasPermission,
  defaultPermissionsForRole,
  CASHIER_DEFAULT_PERMISSIONS,
  STAFF_DEFAULT_PERMISSIONS,
} = require('../src/constants/permissions')
const {
  normalizeAllowedRole,
  assignableRoleError,
  ASSIGNABLE_ROLES,
} = require('../src/utils/accountPolicy')

describe('permissions policy', () => {
  it('rejects unknown permission keys on save', () => {
    const result = assertPermissionsForSave(['order', 'not_a_real_perm'])
    assert.equal(result.ok, false)
    assert.match(result.message, /Unknown permission/)
  })

  it('accepts allowlisted keys and aliases reports_analysis → reports', () => {
    const result = assertPermissionsForSave(['order', 'reports_analysis'])
    assert.equal(result.ok, true)
    assert.deepEqual(result.list.sort(), ['order', 'reports'].sort())
  })

  it('drops unknown keys on read normalize', () => {
    assert.deepEqual(
      normalizePermissions(['order', 'bogus', 'reports_analysis']),
      ['order', 'reports'],
    )
  })

  it('Admin bypasses permission checks', () => {
    assert.equal(userHasPermission({ role: 'Admin', permissions: [] }, 'reports'), true)
  })

  it('Cashier/Staff defaults match plan', () => {
    assert.deepEqual(defaultPermissionsForRole('Cashier').sort(), [...CASHIER_DEFAULT_PERMISSIONS].sort())
    assert.deepEqual(defaultPermissionsForRole('Staff').sort(), [...STAFF_DEFAULT_PERMISSIONS].sort())
    assert.ok(VALID_PERMISSIONS.includes('backup_recovery'))
  })
})

describe('account roles', () => {
  it('maps legacy Supervisor to Cashier on normalize', () => {
    assert.equal(normalizeAllowedRole('Supervisor'), 'Cashier')
    assert.equal(normalizeAllowedRole('Cashier'), 'Cashier')
  })

  it('only Cashier can be assigned to a new or edited user', () => {
    assert.ok(assignableRoleError('Admin'))
    assert.ok(assignableRoleError('Supervisor'))
    assert.ok(assignableRoleError('Staff'))
    assert.ok(assignableRoleError('Owner'))
    assert.equal(assignableRoleError('Cashier'), null)
    assert.deepEqual(ASSIGNABLE_ROLES, ['Cashier'])
  })

  it('an existing Staff role is still read correctly, so old accounts and old backups keep working', () => {
    assert.equal(normalizeAllowedRole('Staff'), 'Staff')
    assert.equal(normalizeAllowedRole('staff'), 'Staff')
  })
})
