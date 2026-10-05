import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, X, AlertTriangle, ShieldCheck, Lock } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { useAuth } from '../../context/AuthContext'
import { isAdminRole } from '../../utils/permissions'
import { formatUsd } from '../../utils/currency'

const PRESET_REASONS = [
  'Customer Cancellation',
  'Wrong Items Entered',
  'Order Mistake / Duplicate',
  'Payment Processing Error',
  'Quality / Taste Issue',
]

export default function VoidOrderModal({ isOpen, onClose, order, onConfirmVoid }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })

  const [reason, setReason] = useState('')
  const [managerUsername, setManagerUsername] = useState('')
  const [managerPassword, setManagerPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen || !order) return null

  const isAdmin = isAdminRole(user?.role)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError(t('sales.reasonRequired', { defaultValue: 'Please provide a reason for the refund.' }))
      return
    }

    if (!isAdmin && (!managerUsername.trim() || !managerPassword)) {
      setError(t('sales.managerAuthRequired', { defaultValue: 'Manager credentials are required to authorize a void/refund.' }))
      return
    }

    if (!order.order_id) {
      setError('This sale is still syncing. Please try again in a moment.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onConfirmVoid?.(order.order_id, reason.trim(), {
        username: managerUsername.trim(),
        password: managerPassword,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to refund order')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label={t('a11y.close')} className="modal-backdrop" onClick={onClose} />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="modal-panel relative z-10 w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-700 dark:text-rose-300">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-heading text-lg font-bold">
                {t('sales.voidOrderTitle', { defaultValue: 'Void & Refund Order' })}
              </h3>
              <p className="text-muted text-xs">
                {order.id || order.invoice_id} · {formatUsd(order.total)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Warning Notice */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <p className="font-semibold">
              {t('sales.voidNoticeTitle', { defaultValue: 'Automatic Stock Restoration' })}
            </p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300 leading-normal">
              {t('sales.voidNoticeDesc', {
                defaultValue: 'Refunding this transaction will update its status to Refunded and return all recipe ingredients back into inventory.',
              })}
            </p>
          </div>

          {/* Reason Selection */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-zinc-400">
              {t('sales.refundReason', { defaultValue: 'Reason for Void / Refund *' })}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5 mb-2">
              {PRESET_REASONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setReason(p)}
                  className={`rounded-lg border px-2 py-1 text-xs transition ${
                    reason === p
                      ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('sales.specifyReason', { defaultValue: 'Enter or select refund reason...' })}
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm focus:border-rose-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>

          {/* Manager Authentication (if not Admin) */}
          {!isAdmin && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-zinc-300">
                <Lock className="h-3.5 w-3.5 text-amber-600" />
                <span>{t('sales.managerApprovalRequired', { defaultValue: 'Manager Authorization Required' })}</span>
              </div>

              <div>
                <label className="text-2xs font-medium text-slate-500 dark:text-zinc-400">
                  {t('users.adminUsername', { defaultValue: 'Manager Username' })}
                </label>
                <input
                  type="text"
                  required
                  value={managerUsername}
                  onChange={(e) => setManagerUsername(e.target.value)}
                  placeholder="admin"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>

              <div>
                <label className="text-2xs font-medium text-slate-500 dark:text-zinc-400">
                  {t('users.password', { defaultValue: 'Manager Password' })}
                </label>
                <input
                  type="password"
                  required
                  value={managerPassword}
                  onChange={(e) => setManagerPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting
                ? t('common.saving', { defaultValue: 'Processing...' })
                : t('sales.confirmVoidBtn', { defaultValue: 'Confirm Void & Restock' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
