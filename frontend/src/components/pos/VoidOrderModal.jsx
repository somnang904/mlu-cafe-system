import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, AlertTriangle, Lock, MessageSquareText, User, KeyRound } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import { useAuth } from '../../context/AuthContext'
import { isAdminRole } from '../../utils/permissions'
import { formatUsd } from '../../utils/currency'
import ModalHeader from '../ui/ModalHeader'
import FieldLabel from '../ui/FieldLabel'

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
      <div className="modal-backdrop" aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="modal-panel relative z-10 w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="border-b border-border p-5">
          <ModalHeader
            icon={RotateCcw}
            iconClassName="text-rose-600 dark:text-rose-400"
            title={t('sales.voidOrderTitle', { defaultValue: 'Void & Refund Order' })}
            subtitle={`${order.id || order.invoice_id} · ${formatUsd(order.total)}`}
            onClose={onClose}
          />
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
            <FieldLabel icon={MessageSquareText} htmlFor="void-reason">
              {t('sales.refundReason', { defaultValue: 'Reason for Void / Refund *' })}
            </FieldLabel>
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
              id="void-reason"
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
                <FieldLabel icon={User} htmlFor="void-manager-username">
                  {t('users.adminUsername', { defaultValue: 'Manager Username' })}
                </FieldLabel>
                <input
                  id="void-manager-username"
                  type="text"
                  required
                  value={managerUsername}
                  onChange={(e) => setManagerUsername(e.target.value)}
                  placeholder="admin"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 text-xs focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>

              <div>
                <FieldLabel icon={KeyRound} htmlFor="void-manager-password">
                  {t('users.password', { defaultValue: 'Manager Password' })}
                </FieldLabel>
                <input
                  id="void-manager-password"
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
              className="btn-secondary flex-1 text-sm"
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
