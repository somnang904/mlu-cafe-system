import { useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'

function passwordMeetsPolicy(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password)
}

export default function ForcePasswordChange() {
  const { t } = useTranslation()
  const { completePasswordChange, logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submittingRef.current || saving || success) return

    setError('')
    if (!currentPassword) {
      setError(t('auth.currentPasswordRequired'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('users.errors.passwordMismatch'))
      return
    }
    if (!passwordMeetsPolicy(password)) {
      setError(t('users.errors.passwordLength'))
      return
    }
    if (currentPassword === password) {
      setError(t('auth.passwordMustDiffer', {
        defaultValue: 'Choose a new password that is different from your current password.',
      }))
      return
    }

    submittingRef.current = true
    setSaving(true)
    try {
      await completePasswordChange({ currentPassword, password, confirmPassword })
      setSuccess(true)
      setError('')
    } catch (err) {
      setError(err.message || t('users.errors.save'))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-obsidian-950">
      <form onSubmit={handleSubmit} className="surface-card w-full max-w-md p-6">
        <h1 className="text-heading text-xl font-semibold">{t('auth.mustChangeTitle')}</h1>
        <p className="text-muted mt-2 text-sm">{t('auth.mustChangeBody')}</p>
        <label className="mt-5 block text-xs font-medium text-slate-600 dark:text-zinc-400" htmlFor="current-password">
          {t('auth.currentPassword')}
        </label>
        <div className="relative mt-1 flex items-center">
          <input
            id="current-password"
            type={showCurrent ? 'text' : 'password'}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="input-field w-full px-3 py-2 pr-9 text-sm"
            disabled={saving || success}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((p) => !p)}
            className="absolute right-2.5 flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
            tabIndex={-1}
            aria-label={showCurrent ? 'Hide password' : 'Show password'}
          >
            {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <label className="mt-4 block text-xs font-medium text-slate-600 dark:text-zinc-400" htmlFor="new-password">
          {t('auth.newPassword')}
        </label>
        <div className="relative mt-1 flex items-center">
          <input
            id="new-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field w-full px-3 py-2 pr-9 text-sm"
            disabled={saving || success}
          />
          <button
            type="button"
            onClick={() => setShowPassword((p) => !p)}
            className="absolute right-2.5 flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <label className="mt-4 block text-xs font-medium text-slate-600 dark:text-zinc-400" htmlFor="confirm-password">
          {t('auth.confirmPassword')}
        </label>
        <div className="relative mt-1 flex items-center">
          <input
            id="confirm-password"
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="input-field w-full px-3 py-2 pr-9 text-sm"
            disabled={saving || success}
          />
          <button
            type="button"
            onClick={() => setShowConfirm((p) => !p)}
            className="absolute right-2.5 flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
            tabIndex={-1}
            aria-label={showConfirm ? 'Hide password' : 'Show password'}
          >
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-muted mt-2 text-xs">{t('users.errors.passwordLength')}</p>
        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {success ? (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{t('auth.passwordUpdated')}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={logout} disabled={saving}>
            {t('nav.signOut')}
          </button>
          <button type="submit" className="btn-primary px-4 py-2 text-sm" disabled={saving || success}>
            {saving ? t('auth.updatingPassword') : t('auth.updatePassword')}
          </button>
        </div>
      </form>
    </div>
  )
}
