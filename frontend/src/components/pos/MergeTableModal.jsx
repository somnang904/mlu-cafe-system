import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitMerge, X, AlertCircle } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'

export default function MergeTableModal({ isOpen, onClose, tables = [], onMerge }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })

  const [fromTableId, setFromTableId] = useState('')
  const [toTableId, setToTableId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  // Active / occupied tables that have orders to merge from
  const occupiedTables = tables.filter((t) => t.status === 'occupied' || (t.items && t.items.length > 0))
  // All other tables that can receive the merged items
  const destinationOptions = tables.filter((t) => String(t.id) !== String(fromTableId))

  const handleMergeSubmit = async (e) => {
    e.preventDefault()
    if (!fromTableId || !toTableId) {
      setError(t('tables.selectBothTables', { defaultValue: 'Please select both source and destination tables.' }))
      return
    }
    if (fromTableId === toTableId) {
      setError(t('tables.mustBeDifferent', { defaultValue: 'Source and destination tables must be different.' }))
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onMerge?.(Number(fromTableId), Number(toTableId))
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to merge tables')
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
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-300">
              <GitMerge className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-heading text-lg font-bold">
                {t('tables.mergeTables', { defaultValue: 'Merge Tables' })}
              </h3>
              <p className="text-muted text-xs">
                {t('tables.mergeSubtitle', { defaultValue: 'Combine orders from one table into another' })}
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

        <form onSubmit={handleMergeSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Source Table */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              {t('tables.mergeFrom', { defaultValue: 'Merge From (Source Table)' })}
            </label>
            <select
              value={fromTableId}
              onChange={(e) => {
                setFromTableId(e.target.value)
                setError('')
              }}
              required
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-medium text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">{t('tables.selectSourceTable', { defaultValue: '-- Select Occupied Table --' })}</option>
              {occupiedTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.items?.length || 0} items)
                </option>
              ))}
            </select>
            <p className="mt-1 text-2xs text-slate-400">
              {t('tables.sourceTableNote', { defaultValue: 'This table will be cleared after its items are moved.' })}
            </p>
          </div>

          {/* Destination Table */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              {t('tables.mergeInto', { defaultValue: 'Merge Into (Destination Table)' })}
            </label>
            <select
              value={toTableId}
              onChange={(e) => {
                setToTableId(e.target.value)
                setError('')
              }}
              required
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-medium text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">{t('tables.selectDestTable', { defaultValue: '-- Select Target Table --' })}</option>
              {destinationOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status === 'occupied' ? `${t.items?.length || 0} items` : 'Empty'})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !fromTableId || !toTableId}
              className="btn-primary flex-1 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t('common.saving', { defaultValue: 'Merging...' }) : t('tables.confirmMerge', { defaultValue: 'Confirm Merge' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
