import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Armchair, ArrowRightFromLine, ArrowRightToLine, Crown, GitMerge, Info } from 'lucide-react'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import IconSelect from '../ui/IconSelect'
import ModalHeader from '../ui/ModalHeader'
import FieldLabel from '../ui/FieldLabel'

const isVipTable = (table) => table.section === 'vip' || String(table.name || '').startsWith('VIP')

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
  const destinationTables = tables.filter((t) => String(t.id) !== String(fromTableId))

  const sourceOptions = occupiedTables.map((table) => ({
    value: String(table.id),
    label: table.name,
    hint: t('tables.orderItemCount', { count: table.items?.length || 0 }),
    icon: isVipTable(table) ? Crown : Armchair,
  }))
  const targetOptions = destinationTables.map((table) => ({
    value: String(table.id),
    label: table.name,
    hint:
      table.status === 'occupied'
        ? t('tables.orderItemCount', { count: table.items?.length || 0 })
        : t('statuses.empty'),
    icon: isVipTable(table) ? Crown : Armchair,
  }))

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

  const hasNoOccupied = occupiedTables.length === 0

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
        <div className="border-b border-border p-5">
          <ModalHeader
            icon={GitMerge}
            iconClassName="text-amber-600 dark:text-amber-400"
            title={t('tables.mergeTables', { defaultValue: 'Merge Tables' })}
            subtitle={t('tables.mergeSubtitle', { defaultValue: 'Combine orders from one table into another' })}
            onClose={onClose}
          />
        </div>

        <form onSubmit={handleMergeSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {hasNoOccupied && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">
                  {t('tables.noOccupiedTablesTitle', { defaultValue: 'គ្មានតុដែលមានការកុម្ម៉ង់ (No Occupied Tables)' })}
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-amber-700 dark:text-amber-300">
                  {t('tables.noOccupiedTablesDesc', { defaultValue: 'មុខងារផ្ដុំតុ (Merge) គឺសម្រាប់បញ្ចូលការកុម្ម៉ង់ពីតុមួយទៅតុមួយទៀត។ បច្ចុប្បន្នតុទាំងអស់នៅទំនេរ (គ្មានការកុម្ម៉ង់កំពុងដំណើរការទេ)។ សូមបើកការកុម្ម៉ង់លើតុជាមុនសិន។' })}
                </p>
              </div>
            </div>
          )}

          {/* Source Table */}
          <div>
            <FieldLabel icon={ArrowRightFromLine} htmlFor="merge-from">
              {t('tables.mergeFrom', { defaultValue: 'Merge From (Source Table)' })}
            </FieldLabel>
            <IconSelect
              id="merge-from"
              value={fromTableId}
              onChange={(value) => {
                setFromTableId(value)
                setError('')
              }}
              placeholder={
                hasNoOccupied
                  ? t('tables.noOccupiedPlaceholder', { defaultValue: 'គ្មានតុដែលមានការកុម្ម៉ង់ទេ' })
                  : t('tables.selectSourceTable', { defaultValue: 'Select an occupied table' })
              }
              options={sourceOptions}
              disabled={hasNoOccupied}
              className="rounded-xl"
            />
            <p className="mt-1.5 text-2xs text-slate-500 dark:text-zinc-400">
              {t('tables.sourceTableNote', { defaultValue: 'This table will be cleared after its items are moved.' })}
            </p>
          </div>

          {/* Destination Table */}
          <div>
            <FieldLabel icon={ArrowRightToLine} htmlFor="merge-to">
              {t('tables.mergeInto', { defaultValue: 'Merge Into (Destination Table)' })}
            </FieldLabel>
            <IconSelect
              id="merge-to"
              value={toTableId}
              onChange={(value) => {
                setToTableId(value)
                setError('')
              }}
              placeholder={t('tables.selectDestTable', { defaultValue: 'Select a target table' })}
              options={targetOptions}
              disabled={hasNoOccupied}
              className="rounded-xl"
            />
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 py-2.5 text-sm font-semibold"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !fromTableId || !toTableId || hasNoOccupied}
              className={`btn-primary flex-1 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                submitting || !fromTableId || !toTableId || hasNoOccupied ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'
              }`}
            >
              {submitting ? t('common.saving', { defaultValue: 'Merging...' }) : t('tables.confirmMerge', { defaultValue: 'Confirm Merge' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
