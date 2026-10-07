import { useEffect, useRef, useState } from 'react'
import { Banknote, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useNotifications } from '../../context/NotificationContext'
import { setSharedExchangeRate, useExchangeRate } from '../../hooks/useExchangeRate'
import { apiFetch } from '../../services/apiClient'
import { MAX_EXCHANGE_RATE, MIN_EXCHANGE_RATE } from '../../utils/currency'
import { isAdminRole } from '../../utils/permissions'

const CHIP_CLASS =
  'flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 text-sm font-semibold text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100'

function formatKhr(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** The editor an admin gets when they click the chip. */
function RateEditor({ rate, onDone }) {
  const { t } = useTranslation()
  const { pushBanner } = useNotifications()
  const [draft, setDraft] = useState(String(rate))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (event) => {
    event.preventDefault()
    if (saving) return
    const value = Number(draft)
    if (!Number.isInteger(value) || value < MIN_EXCHANGE_RATE || value > MAX_EXCHANGE_RATE) {
      setError(
        t('exchangeRate.invalid', { min: formatKhr(MIN_EXCHANGE_RATE), max: formatKhr(MAX_EXCHANGE_RATE) }),
      )
      return
    }
    if (value === rate) {
      onDone()
      return
    }

    setSaving(true)
    setError('')
    try {
      const response = await apiFetch('/settings/exchange-rate', {
        method: 'PUT',
        body: JSON.stringify({ rate: value }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('exchangeRate.saveFailed'))
      setSharedExchangeRate(data.rate)
      pushBanner({
        title: t('exchangeRate.saved'),
        message: t('dashboard.usdToKhr', { rate: formatKhr(data.rate) }),
        tone: 'success',
        durationMs: 4000,
      })
      onDone()
    } catch (err) {
      pushBanner({
        title: t('exchangeRate.saveFailed'),
        message: err.message,
        tone: 'error',
        durationMs: 8000,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <p className="text-heading text-sm font-semibold">{t('exchangeRate.label')}</p>
      <div className="flex items-center gap-2">
        <span className="text-heading text-lg font-semibold">$1 =</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_EXCHANGE_RATE}
          max={MAX_EXCHANGE_RATE}
          step="1"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setError('')
          }}
          autoFocus
          aria-label={t('exchangeRate.label')}
          aria-invalid={error ? true : undefined}
          className="input-field w-24 px-2.5 py-1.5 text-base font-semibold tabular-nums"
        />
        <span className="text-heading text-lg font-semibold">៛</span>
      </div>
      <p
        className={`text-xs ${error ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}
        role={error ? 'alert' : undefined}
      >
        {error ||
          t('exchangeRate.hint', { min: formatKhr(MIN_EXCHANGE_RATE), max: formatKhr(MAX_EXCHANGE_RATE) })}
      </p>
      <p className="text-muted text-xs">{t('exchangeRate.description')}</p>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="btn-secondary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

/**
 * The shop's USD -> KHR rate. In the top bar it is hidden on phones to save room; the
 * "inline" variant (used beside the Payment page's Shift button) is always shown.
 * An admin changes the rate with the pencil; everyone else just reads it.
 */
export default function ExchangeRateChip({ variant = 'header' }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const rate = useExchangeRate()
  const canEdit = isAdminRole(user?.role)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const label = t('dashboard.usdToKhr', { rate: formatKhr(rate) })
  const showFlex = variant === 'inline' ? 'flex' : 'hidden sm:flex'
  const showBlock = variant === 'inline' ? 'block' : 'hidden sm:block'

  if (!canEdit) {
    return (
      <span className={`${CHIP_CLASS} ${showFlex}`} title={t('dashboard.exchangeRate')}>
        <Banknote className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <span className="whitespace-nowrap tabular-nums">{label}</span>
      </span>
    )
  }

  return (
    <div ref={wrapperRef} className={`relative ${showBlock}`}>
      <div className={`${CHIP_CLASS} pr-1.5`}>
        <Banknote className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <span className="whitespace-nowrap tabular-nums">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('exchangeRate.edit')}
          title={t('exchangeRate.edit')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-700 transition-colors hover:bg-amber-200/70 dark:text-amber-300 dark:hover:bg-amber-900/60"
        >
          <Pencil className="h-3 w-3" aria-hidden />
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label={t('exchangeRate.edit')}
          className="surface-card absolute right-0 top-full z-50 mt-2 w-72 p-4 shadow-xl"
        >
          <RateEditor rate={rate} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  )
}
