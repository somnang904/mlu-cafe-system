import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AtSign,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  SquarePen,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../services/apiClient'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import FieldLabel from '../components/ui/FieldLabel'
import ModalHeader from '../components/ui/ModalHeader'
import Tooltip from '../components/ui/Tooltip'
import { useAuth } from '../context/AuthContext'
import {
  CASHIER_DEFAULT_PERMISSIONS,
  defaultPermissionsForRole,
  isAdminRole,
  normalizePermissions,
  permissionOptionsForRole,
} from '../utils/permissions'

const roleColors = {
  Admin: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800/50',
  Cashier: 'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800/50',
  Staff: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
}

const ROLE_LABEL_KEYS = {
  Staff: 'users.roles.staff',
  Cashier: 'users.roles.cashier',
  Admin: 'users.roles.admin',
}

const PERMISSION_LABEL_KEYS = {
  dashboard: 'nav.dashboard',
  order: 'nav.order',
  table: 'nav.table',
  reservations: 'nav.reservations',
  payment: 'nav.payment',
  menu: 'nav.menuManagement',
  settings: 'nav.settings',
  backup_recovery: 'nav.backupRecovery',
  sales_history: 'nav.salesHistory',
  inventory_stock: 'nav.inventoryStock',
  reports: 'nav.reports',
}

function passwordMeetsPolicy(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password)
}

function roleLabel(t, role) {
  const key = ROLE_LABEL_KEYS[role]
  return key ? t(key) : role
}

function permissionLabel(t, permissionId) {
  const key = PERMISSION_LABEL_KEYS[permissionId]
  return key ? t(key) : permissionId
}

function sortUsersWithAdminsFirst(userList) {
  return [...userList].sort((a, b) => {
    const aIsAdmin = isAdminRole(a.role)
    const bIsAdmin = isAdminRole(b.role)
    if (aIsAdmin !== bIsAdmin) return aIsAdmin ? -1 : 1
    return String(a.display_name || '').localeCompare(String(b.display_name || ''))
  })
}

function UserFormModal({ mode, user, onClose, onSave }) {
  const { t } = useTranslation()
  const isEdit = mode === 'edit'
  const editingExistingAdmin = isEdit && isAdminRole(user?.role)
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const role = editingExistingAdmin ? 'Admin' : 'Cashier'
  const [permissions, setPermissions] = useState(() => {
    if (isAdminRole(user?.role)) return []
    if (user?.permissions) return normalizePermissions(user.permissions)
    return [...CASHIER_DEFAULT_PERMISSIONS]
  })
  const [error, setError] = useState('')
  const isAdminUser = editingExistingAdmin
  const availablePermissions = useMemo(() => permissionOptionsForRole(), [])

  const handlePermissionToggle = (sectionId) => {
    setPermissions((prev) =>
      prev.includes(sectionId)
        ? prev.filter((permission) => permission !== sectionId)
        : [...prev, sectionId],
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!displayName.trim() || !username.trim()) {
      setError(t('users.errors.requiredIdentity'))
      return
    }

    if (!isEdit) {
      if (!password || !confirmPassword) {
        setError(t('users.errors.newPasswordRequired'))
        return
      }
    } else if (password || confirmPassword) {
      if (!password || !confirmPassword) {
        setError(t('users.errors.partialPassword'))
        return
      }
    }

    if ((password || confirmPassword) && password !== confirmPassword) {
      setError(t('users.errors.passwordMismatch'))
      return
    }

    if (password && !passwordMeetsPolicy(password)) {
      setError(t('users.errors.passwordLength'))
      return
    }

    const payload = {
      display_name: displayName.trim(),
      username: username.toLowerCase().replace(/\s+/g, ''),
      role,
      permissions: isAdminUser
        ? defaultPermissionsForRole('Admin')
        : normalizePermissions(permissions),
    }

    if (password) {
      payload.password = password
    }

    try {
      await onSave(payload)
    } catch (err) {
      setError(err.message || t('users.errors.save'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />

      <div className="modal-panel relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto p-6">
        <ModalHeader
          icon={isEdit ? ShieldCheck : UserPlus}
          title={isEdit ? t('users.editPermissions') : t('users.addNew')}
          subtitle={
            isEdit
              ? isAdminUser
                ? t('users.editAdminDescription')
                : t('users.editStaffDescription')
              : t('users.createDescription')
          }
          onClose={onClose}
        />

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <FieldLabel icon={User} htmlFor="user-display-name">
              {t('users.displayName')}
            </FieldLabel>
            <input
              id="user-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('users.displayNamePlaceholder')}
              className="input-field px-3 py-2 text-sm"
            />
          </div>

          <div>
            <FieldLabel icon={AtSign} htmlFor="user-username">
              {t('users.usernameLoginId')}
            </FieldLabel>
            <input
              id="user-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('users.usernamePlaceholder')}
              disabled={isEdit}
              className="input-field px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel icon={Lock} htmlFor="user-password">
                {isEdit ? t('users.newPasswordOptional') : t('users.password')}
              </FieldLabel>
              <div className="relative flex items-center">
                <input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEdit ? t('users.keepCurrentPassword') : '••••••'}
                  autoComplete="new-password"
                  className="input-field w-full px-3 py-2 pr-9 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 flex h-6 w-6 items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {isEdit && (
                <p className="mt-1 text-2xs text-stone-400">{t('users.passwordResetHint')}</p>
              )}
            </div>
            <div>
              <FieldLabel icon={KeyRound} htmlFor="user-confirm-password">
                {t('users.confirmPassword')}
              </FieldLabel>
              <div className="relative flex items-center">
                <input
                  id="user-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={isEdit ? t('users.reenterPassword') : '••••••'}
                  autoComplete="new-password"
                  className="input-field w-full px-3 py-2 pr-9 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-2 flex h-6 w-6 items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <FieldLabel icon={ShieldCheck} htmlFor="user-role">
              {t('users.assignmentRole')}
            </FieldLabel>
            <p
              id="user-role"
              className={`input-field flex items-center gap-2.5 px-3 py-2 text-sm font-medium ${
                editingExistingAdmin
                  ? 'text-emerald-800 dark:text-emerald-200'
                  : 'text-slate-900 dark:text-zinc-100'
              }`}
            >
              {editingExistingAdmin ? null : <Wallet className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />}
              {roleLabel(t, role)}
            </p>
            <p className="text-muted mt-1.5 text-2xs leading-snug">
              {editingExistingAdmin ? t('users.roleBlurbAdminFixed') : t('users.roleBlurbCashier')}
            </p>
          </div>

          {!isAdminUser ? (
            <div>
              <FieldLabel icon={UserCheck}>{t('users.featurePermissions')}</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                {availablePermissions.map((section) => (
                  <label
                    key={section.id}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-200 p-2.5 text-xs font-medium transition-all hover:bg-stone-50 dark:border-obsidian-800 dark:hover:bg-obsidian-900/50"
                  >
                    <input
                      type="checkbox"
                      checked={permissions.includes(section.id)}
                      onChange={() => handlePermissionToggle(section.id)}
                      className="h-4 w-4 rounded border-stone-300 text-forest-600 focus:ring-forest-500"
                    />
                    <span>{permissionLabel(t, section.id)}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              {t('users.adminFullAccessDescription')}
            </div>
          )}

          {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-3 pt-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2 text-xs font-semibold">{t('common.cancel')}</button>
            <button
              type="submit"
              className="btn-primary beam-border flex-1 py-2 text-xs font-semibold shadow-[0_4px_14px_rgba(16,185,129,0.35)]"
            >
              {isEdit ? t('common.saveChanges') : t('users.createUser')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Users() {
  const { t } = useTranslation()
  const { user: currentUser, adoptSession } = useAuth()
  const [users, setUsers] = useState([])
  const [modalMode, setModalMode] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [userToDelete, setUserToDelete] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')

  const fetchUsers = useCallback(async () => {
    try {
      const res = await apiFetch('/users')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || t('users.errors.load'))
      setUsers(sortUsersWithAdminsFirst(Array.isArray(data) ? data : []))
    } catch (err) {
      console.error('Error fetching system logs:', err)
      setError(err.message || t('users.errors.load'))
      setUsers([])
    }
  }, [t])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const openCreateModal = () => {
    setSelectedUser(null)
    setModalMode('create')
  }

  const openEditModal = (user) => {
    setSelectedUser(user)
    setModalMode('edit')
  }

  const closeModal = () => {
    setModalMode(null)
    setSelectedUser(null)
  }

  const handleSaveUser = async (payload) => {
    try {
      setError('')
      const isEdit = modalMode === 'edit' && selectedUser?.id

      const res = await apiFetch(isEdit ? `/users/${selectedUser.id}` : '/users', {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.message || t('users.errors.save'))
      }

      if (data.token && data.user) {
        adoptSession(data.token, data.user)
      }

      closeModal()
      fetchUsers()
    } catch (err) {
      setError(err.message || t('users.errors.save'))
      throw err
    }
  }

  const requestDeleteUser = (event, user) => {
    event.stopPropagation()
    setError('')
    setUserToDelete(user)
  }

  const confirmDeleteUser = async () => {
    if (!userToDelete?.id || isDeleting) return

    try {
      setIsDeleting(true)
      setError('')
      const res = await apiFetch(`/users/${userToDelete.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.message || t('users.errors.delete'))
      }
      setUserToDelete(null)
      if (selectedUser?.id === userToDelete.id) closeModal()
      fetchUsers()
    } catch (err) {
      setError(err.message || t('users.errors.delete'))
      setUserToDelete(null)
    } finally {
      setIsDeleting(false)
    }
  }

  const adminCount = users.filter((account) => isAdminRole(account.role)).length

  const getDeleteGuard = (account) => {
    const isSelf = Number(currentUser?.id) === Number(account.id)
    const isLastAdmin = isAdminRole(account.role) && adminCount <= 1
    if (isSelf) {
      return { canDelete: false, title: t('users.cannotDeleteSelf') }
    }
    if (isLastAdmin) {
      return { canDelete: false, title: t('users.cannotDeleteLastAdmin') }
    }
    return { canDelete: true, title: t('users.deleteAccount', { name: account.display_name }) }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-heading text-lg font-bold">{t('nav.users')}</h3>
        <button
          type="button"
          onClick={openCreateModal}
          className="btn-primary beam-border inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold shadow-[0_4px_14px_rgba(16,185,129,0.35)]"
        >
          <UserPlus className="h-4 w-4" />
          {t('users.addNew')}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="table-shell overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="table-head text-xs uppercase tracking-wider">
                <th className="px-6 py-3.5">{t('common.name')}</th>
                <th className="px-6 py-3.5">{t('users.assignmentRole')}</th>
                <th className="px-6 py-3.5">{t('users.activePermissions')}</th>
                <th className="px-6 py-3.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="table-divider">
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="table-row hover:bg-stone-50/50 dark:hover:bg-obsidian-900/20"
                >
                  <td className="px-6 py-4">
                    <p className="text-heading text-sm font-semibold">{user.display_name}</p>
                    <p className="text-xs text-stone-400">@{user.username}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${roleColors[user.role] || roleColors.Staff}`}>
                      {roleLabel(t, user.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {isAdminRole(user.role) ? (
                        <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-2xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                          {t('users.fullSystemAccess')}
                        </span>
                      ) : user.permissions && user.permissions.length > 0 ? (
                        normalizePermissions(user.permissions).map((permission) => (
                          <span key={permission} className="rounded-lg bg-olive-50 px-2 py-0.5 text-2xs font-medium text-forest-700 dark:bg-olive-900/20 dark:text-forest-400">
                            {permissionLabel(t, permission)}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs italic text-stone-400">{t('users.noPermissions')}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>
                    <div className="ml-auto flex w-fit items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
                      <Tooltip label={t('common.edit')}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditModal(user)
                          }}
                          aria-label={t('users.editUser')}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-forest-50 hover:text-forest-600 focus-visible:outline-2 focus-visible:outline-forest-500 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300"
                        >
                          <SquarePen className="h-4 w-4" aria-hidden />
                        </button>
                      </Tooltip>
                      {isAdminRole(user.role)
                        ? null
                        : (() => {
                            const { canDelete, title } = getDeleteGuard(user)
                            return (
                              <>
                                <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                                <Tooltip label={t('common.delete')}>
                                  <button
                                    type="button"
                                    onClick={(event) => canDelete && requestDeleteUser(event, user)}
                                    disabled={!canDelete}
                                    aria-label={title}
                                    className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </button>
                                </Tooltip>
                              </>
                            )
                          })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode && (
        <UserFormModal
          key={`${modalMode}-${selectedUser?.id ?? 'new'}`}
          mode={modalMode}
          user={selectedUser}
          onClose={closeModal}
          onSave={handleSaveUser}
        />
      )}
      <ConfirmDeleteModal
        isOpen={Boolean(userToDelete)}
        title={t('users.deleteTitle')}
        itemName={userToDelete ? `${userToDelete.display_name} (@${userToDelete.username})` : ''}
        message={t('users.deleteMessage')}
        confirmLabel={isDeleting ? t('common.deleting') : t('common.deleteConfirm')}
        onCancel={() => !isDeleting && setUserToDelete(null)}
        onConfirm={confirmDeleteUser}
      />
    </div>
  )
}
