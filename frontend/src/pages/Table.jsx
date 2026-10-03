import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  BaggageClaim,
  Check,
  Crown,
  LayoutGrid,
  Phone,
  Plus,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePOS } from '../context/POSContext'
import { useAlerts } from '../context/AlertsContext'
import { FLOOR_STATUS_KEYS, TABLE_STATUS_META } from '../data/tables'
import { canCheckInReservation, SEATED_STATUS, slotLabel } from '../data/reservations'
import { calculateTotals } from '../utils/posHelpers'
import { translateMenuSummary } from '../utils/menuNameTranslations'
import { apiFetch, getAuthToken } from '../services/apiClient'
import { useModalKeyboard } from '../hooks/useModalKeyboard'

function getFloorStatus(bill, reservation) {
  if (bill?.status === 'paid') return 'paid'
  if (bill?.status && bill.status !== 'empty') return 'occupied'
  if (reservation?.status === SEATED_STATUS) return 'occupied'
  if (reservation) return 'reserved'
  return 'empty'
}

function floorTableDisplayName(bill, t) {
  if (!bill) return t('tables.table')
  if (bill.isTakeOut || bill.id === 'takeout' || bill.section === 'takeout') {
    return t('tables.takeOut')
  }
  if (bill.section === 'vip' || String(bill.name || '').startsWith('VIP')) {
    const match = String(bill.name || '').match(/(\d+)/)
    return t('tables.vipRoomNumber', { number: match ? match[1] : bill.id })
  }
  const match = String(bill.name || '').match(/(\d+)/)
  return t('tables.tableNumber', { number: match ? match[1] : bill.id })
}

function ReservationPreview({
  reservation,
  busy,
  error,
  onClose,
  onCheckIn,
  onOpenOrder,
  onCancel,
}) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: Boolean(reservation), onEscape: onClose, primaryActionMode: 'never' })
  const [confirmCancel, setConfirmCancel] = useState(false)

  if (!reservation) return null

  const canCheckIn = canCheckInReservation(reservation)
  const isSeated = reservation.status === SEATED_STATUS
  const statusMeta = isSeated
    ? { labelKey: 'statuses.seated' }
    : { labelKey: 'statuses.reserved' }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label={t('a11y.closeReservationPreview')} className="modal-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 max-h-[90vh] w-full max-w-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reserved-table-title"
      >
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide ${
                isSeated ? 'text-emerald-700 dark:text-emerald-300' : 'text-violet-700 dark:text-violet-300'
              }`}>
                {t(statusMeta.labelKey)}
              </p>
              <h4 id="reserved-table-title" className="text-heading mt-1 text-lg font-semibold">
                {floorTableDisplayName(
                  {
                    id: reservation.table_id,
                    name: reservation.table_name,
                    section: String(reservation.table_name || '').startsWith('VIP') ? 'vip' : 'standard',
                  },
                  t,
                )}
              </h4>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-olive-50 dark:hover:bg-zinc-800"
              aria-label={t('a11y.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted text-xs uppercase tracking-wide">{t('tables.customerName')}</dt>
              <dd className="mt-0.5 font-medium">{reservation.customer_name}</dd>
            </div>
            <div>
              <dt className="text-muted text-xs uppercase tracking-wide">{t('tables.time')}</dt>
              <dd className="mt-0.5 font-medium">
                {slotLabel(reservation.time_slot, reservation.time_slot_label, reservation.duration_minutes)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-xs uppercase tracking-wide">{t('tables.phone')}</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <a href={`tel:${reservation.phone}`} className="text-forest-700 underline hover:text-forest-800 dark:text-forest-300">
                  {reservation.phone}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted text-xs uppercase tracking-wide">{t('tables.guests')}</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {reservation.guest_count}
              </dd>
            </div>
            {reservation.notes && (
              <div>
                <dt className="text-muted text-xs uppercase tracking-wide">{t('tables.notes')}</dt>
                <dd className="mt-0.5 text-muted-foreground">{reservation.notes}</dd>
              </div>
            )}
          </dl>

          {error && (
            <div className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 space-y-2">
            {canCheckIn && (
              <button
                type="button"
                disabled={busy}
                onClick={onCheckIn}
                className="btn-primary flex w-full items-center justify-center gap-2 py-2.5 text-sm"
              >
                <UserCheck className="h-4 w-4" />
                {t('tables.checkInGuest')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onOpenOrder}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-forest-300/80 bg-white py-2.5 text-sm font-semibold text-forest-800 hover:bg-forest-50 dark:border-forest-700/60 dark:bg-obsidian-850 dark:text-mint-100 dark:hover:bg-forest-950/30"
            >
              <UtensilsCrossed className="h-4 w-4" />
              {t('tables.openOrderTicket')}
            </button>
            {confirmCancel ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                  className="btn-secondary flex-1 py-2 text-sm"
                >
                  {t('tables.keepBooking')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCancel}
                  className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
                >
                  {t('tables.confirmCancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
                className="w-full rounded-xl py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                {t('tables.cancelBooking')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AddTableModal({ isOpen, onClose, onAddTable }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })
  const [name, setName] = useState('')
  const [section, setSection] = useState('standard')
  const [capacity, setCapacity] = useState('4')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setName('')
      setSection('standard')
      setCapacity('4')
      setError('')
      setBusy(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSectionChange = (newSection) => {
    setSection(newSection)
    if (newSection === 'vip' && capacity === '4') {
      setCapacity('12')
    } else if (newSection === 'standard' && capacity === '12') {
      setCapacity('4')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('tables.errors.tableNameRequired'))
      return
    }
    const cap = parseInt(capacity, 10)
    if (!Number.isInteger(cap) || cap < 1) {
      setError('Capacity must be at least 1')
      return
    }

    setBusy(true)
    setError('')
    try {
      await onAddTable({ name: trimmed, section, capacity: cap })
      onClose()
    } catch (err) {
      setError(err.message || t('tables.errors.addTable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label={t('a11y.close')} className="modal-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-heading text-lg font-bold">{t('tables.addTable')}</h4>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-olive-50 dark:hover:bg-zinc-800"
            aria-label={t('a11y.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-muted mb-1 block text-xs font-semibold uppercase tracking-wider">
              {t('tables.tableName')}
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('tables.tableNamePlaceholder')}
              className="input-field w-full"
            />
          </div>

          <div>
            <label className="text-muted mb-1 block text-xs font-semibold uppercase tracking-wider">
              {t('tables.section')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSectionChange('standard')}
                className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
                  section === 'standard'
                    ? 'border-forest-600 bg-forest-50 text-forest-800 dark:border-forest-400 dark:bg-forest-950/40 dark:text-forest-200'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-obsidian-850 dark:text-zinc-300'
                }`}
              >
                {t('tables.standard')}
              </button>
              <button
                type="button"
                onClick={() => handleSectionChange('vip')}
                className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
                  section === 'vip'
                    ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-obsidian-850 dark:text-zinc-300'
                }`}
              >
                {t('tables.vip')}
              </button>
            </div>
          </div>

          <div>
            <label className="text-muted mb-1 block text-xs font-semibold uppercase tracking-wider">
              {t('tables.capacity')}
            </label>
            <input
              type="number"
              min="1"
              max="50"
              required
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder={t('tables.capacityPlaceholder')}
              className="input-field w-full"
            />
          </div>

          <div className="mt-6 flex justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="btn-secondary px-4 py-2 text-sm"
            >
              {t('tables.cancelButton')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold"
            >
              {busy ? <span className="spinner h-4 w-4" /> : null}
              {t('tables.addTable')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TransferTableModal({ isOpen, onClose, sourceBill, emptyTables, onTransfer }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })
  const [destTableId, setDestTableId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setDestTableId(emptyTables?.[0]?.id ? String(emptyTables[0].id) : '')
      setError('')
      setBusy(false)
    }
  }, [isOpen, emptyTables])

  if (!isOpen || !sourceBill) return null

  const { total } = calculateTotals(sourceBill.items || [])
  const sourceName = floorTableDisplayName(sourceBill, t)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const targetId = parseInt(destTableId, 10)
    if (!Number.isInteger(targetId) || targetId <= 0) {
      setError(t('tables.selectDestinationTable'))
      return
    }

    setBusy(true)
    setError('')
    try {
      await onTransfer(sourceBill.id, targetId)
      onClose()
    } catch (err) {
      setError(err.message || t('tables.errors.transferTable'))
    } finally {
      setBusy(false)
    }
  }

  const standardEmpty = emptyTables.filter((t) => t.section !== 'vip')
  const vipEmpty = emptyTables.filter((t) => t.section === 'vip')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label={t('a11y.close')} className="modal-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-heading text-lg font-bold">{t('tables.changeTable')}</h4>
              <p className="text-muted text-xs">{sourceName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-olive-50 dark:hover:bg-zinc-800"
            aria-label={t('a11y.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 dark:border-amber-800/40 dark:bg-amber-950/20">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted font-medium">{t('order.currentOrder')}</span>
            <span className="font-bold text-forest-700 dark:text-forest-400">${total.toFixed(2)}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {sourceBill.items?.length || 0} {t('order.itemLines', { count: sourceBill.items?.length || 0 })}
          </div>
        </div>

        {emptyTables.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">{t('tables.noEmptyTables')}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-muted mb-1 block text-xs font-semibold uppercase tracking-wider">
                {t('tables.selectDestinationTable')}
              </label>
              <select
                value={destTableId}
                onChange={(e) => setDestTableId(e.target.value)}
                className="input-field w-full"
                required
              >
                {standardEmpty.length > 0 && (
                  <optgroup label={t('tables.standardTables')}>
                    {standardEmpty.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.name} ({table.capacity} seats)
                      </option>
                    ))}
                  </optgroup>
                )}
                {vipEmpty.length > 0 && (
                  <optgroup label={t('tables.vipRooms')}>
                    {vipEmpty.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.name} ({table.capacity} seats)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="mt-6 flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="btn-secondary px-4 py-2 text-sm"
              >
                {t('tables.cancelButton')}
              </button>
              <button
                type="submit"
                disabled={busy || !destTableId}
                className="btn-primary inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold"
              >
                {busy ? <span className="spinner h-4 w-4" /> : null}
                {t('tables.confirmTransfer')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function ClearTableModal({ isOpen, onClose, bill, onClear }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setError('')
      setBusy(false)
    }
  }, [isOpen])

  if (!isOpen || !bill) return null

  const tableName = floorTableDisplayName(bill, t)
  const { total } = calculateTotals(bill.items || [])

  const handleConfirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onClear(bill.id)
      onClose()
    } catch (err) {
      setError(err.message || t('tables.errors.clearTable'))
    } finally {
      setBusy(false)
    }
  }

  const isPaid = bill.status === 'paid'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label={t('a11y.close')} className="modal-backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 w-full max-w-sm p-6"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
              isPaid
                ? 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'
                : 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300'
            }`}
          >
            {isPaid ? <Sparkles className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <h4 className="text-heading text-lg font-bold">
              {isPaid
                ? `${t('payment.clearNow')} - ${tableName}`
                : t('tables.confirmClearTitle', { table: tableName })}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPaid
                ? t('payment.clearImmediatelyDesc')
                : t('tables.confirmClearMessage')}
            </p>
            {total > 0 && !isPaid && (
              <div className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
                ${total.toFixed(2)} · {bill.items?.length || 0} items
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="btn-secondary flex-1 py-2 text-sm"
          >
            {t('tables.cancelButton')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              isPaid
                ? 'bg-teal-600 hover:bg-teal-500'
                : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {busy ? <span className="spinner mr-1.5 inline-block h-3.5 w-3.5" /> : null}
            {isPaid ? t('payment.clearNow') : t('tables.confirmClearButton')}
          </button>
        </div>
      </div>
    </div>
  )
}

function TableCard({
  bill,
  reservation,
  onSendToCheckout,
  onOpenReservation,
  onChangeTable,
  onClearTable,
  onOpenOrder,
}) {
  const { t, i18n } = useTranslation()
  const floorStatus = getFloorStatus(bill, reservation)
  const meta = TABLE_STATUS_META[floorStatus] || TABLE_STATUS_META.empty
  const isEmpty = floorStatus === 'empty'
  const isReserved = floorStatus === 'reserved'
  const isPaid = floorStatus === 'paid'
  const hasItems = Array.isArray(bill.items) && bill.items.length > 0
  const { total } = isEmpty || isReserved || isPaid || !hasItems ? { total: 0 } : calculateTotals(bill.items)
  const isActive = floorStatus === 'occupied'
  const isVip = bill.section === 'vip' || String(bill.name).startsWith('VIP')
  const canOpenPreview = Boolean(reservation) && (isReserved || (isActive && !hasItems))

  return (
    <div
      className={`flex select-none flex-col rounded-2xl border p-5 shadow-sm ${meta.card} ${
        canOpenPreview ? 'cursor-pointer' : 'cursor-default'
      }`}
      onClick={() => {
        if (canOpenPreview) onOpenReservation(reservation)
      }}
      onKeyDown={(event) => {
        if (!canOpenPreview) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenReservation(reservation)
        }
      }}
      role={canOpenPreview ? 'button' : undefined}
      tabIndex={canOpenPreview ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`flex items-center gap-1.5 text-lg font-bold ${isEmpty ? 'text-emerald-700 dark:text-emerald-400' : 'text-heading'}`}>
            {isVip ? <Crown className="h-4 w-4 text-violet-600 dark:text-violet-300" /> : null}
            {floorTableDisplayName(bill, t)}
          </p>
          {!isEmpty && !isReserved && !isPaid && bill.orderSummary && hasItems && (
            <p className="text-muted mt-1 line-clamp-2 text-xs">
              {translateMenuSummary(bill.orderSummary, i18n.language, t)}
            </p>
          )}
          {isPaid && (
            <p className="mt-1 line-clamp-2 text-xs font-medium text-teal-700 dark:text-teal-300">
              {t('payment.tableMarkedPaid')}
            </p>
          )}
          {isReserved && (
            <p className="mt-1 line-clamp-2 text-xs text-violet-700 dark:text-violet-300">
              {reservation.customer_name} · {slotLabel(reservation.time_slot, reservation.time_slot_label, reservation.duration_minutes)}
            </p>
          )}
          {isActive && reservation && !hasItems && (
            <p className="mt-1 line-clamp-2 text-xs text-amber-800 dark:text-amber-200">
              {reservation.customer_name} · {t('statuses.seated')}
            </p>
          )}
        </div>
        <span className={`shrink-0 cursor-default select-none rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.badge}`}>
          {t(meta.labelKey)}
        </span>
      </div>

      <div className="mt-4 flex flex-1 flex-col justify-end">
        {isActive && hasItems && (
          <p className="text-2xl font-bold tabular-nums text-forest-700 dark:text-forest-400">
            ${total.toFixed(2)}
          </p>
        )}
        {isEmpty && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{t('statuses.available')}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenOrder(bill)
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-300/80 bg-white py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-700/60 dark:bg-obsidian-850 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              <UtensilsCrossed className="h-3.5 w-3.5" />
              {t('tables.openOrderTicket')}
            </button>
          </div>
        )}
        {isReserved && (
          <p className="text-sm font-medium text-violet-700 dark:text-violet-300">{t('tables.tapReservationDetails')}</p>
        )}
        {isActive && reservation && !hasItems && (
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('tables.guestSeatedOpenTicket')}</p>
        )}
        {isPaid && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-teal-700 dark:text-teal-300">
              {t('payment.keepSeatedDesc')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClearTable(bill)
                }}
                className="inline-flex flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-xl border border-teal-300 bg-teal-600 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-700 dark:border-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('payment.clearNow')}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenOrder(bill)
                }}
                className="inline-flex cursor-pointer select-none items-center justify-center gap-1.5 rounded-xl border border-emerald-300/80 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-700/60 dark:bg-obsidian-850 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                title={t('tables.openOrderTicket')}
              >
                <UtensilsCrossed className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('tables.openOrderTicket')}</span>
              </button>
            </div>
          </div>
        )}

        {isActive && hasItems && (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSendToCheckout(bill)
              }}
              className="inline-flex w-full cursor-pointer select-none items-center justify-center gap-2 rounded-xl border border-forest-300/70 bg-white py-2 text-sm font-semibold text-forest-800 shadow-sm transition hover:bg-forest-50 dark:border-forest-700/50 dark:bg-obsidian-850 dark:text-mint-100 dark:hover:bg-forest-950/30"
            >
              {t('tables.sendToCheckout')}
              <ArrowRight className="h-4 w-4" />
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onChangeTable(bill)
                }}
                className="inline-flex flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-xl border border-amber-300/80 bg-amber-50/70 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
                title={t('tables.changeTable')}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {t('tables.changeTable')}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClearTable(bill)
                }}
                className="inline-flex flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60"
                title={t('tables.clearTable')}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('tables.clearTable')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TakeOutCard({ bill, onSendToCheckout, onClearTable }) {
  const { t, i18n } = useTranslation()
  const floorStatus = getFloorStatus(bill)
  const meta = TABLE_STATUS_META[floorStatus] || TABLE_STATUS_META.empty
  const isEmpty = floorStatus === 'empty'
  const isPaid = floorStatus === 'paid'
  const { total } = isEmpty || isPaid ? { total: 0 } : calculateTotals(bill.items)
  const isActive = floorStatus === 'occupied'

  return (
    <div
      className={`col-span-full cursor-default select-none rounded-2xl border-2 p-6 shadow-md ${
        isActive
          ? meta.card
          : isPaid
            ? meta.card
            : 'border-dashed border-emerald-300/70 bg-emerald-50/20 dark:border-emerald-700/50 dark:bg-emerald-950/10'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-forest-500 text-white shadow-lg shadow-forest-900/20">
            <BaggageClaim className="h-7 w-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-heading text-xl font-bold">{t('tables.takeOut')}</h4>
              <span className={`cursor-default select-none rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.badge}`}>
                {t(meta.labelKey)}
              </span>
            </div>
            <p className="text-muted mt-1 text-sm">
              {isEmpty
                ? t('tables.noTakeOutTickets')
                : isPaid
                  ? t('payment.tableMarkedPaid')
                  : translateMenuSummary(bill.orderSummary, i18n.language, t)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:text-right">
          {isActive && (
            <p className="text-3xl font-bold tabular-nums text-forest-700 dark:text-forest-400">
              ${total.toFixed(2)}
            </p>
          )}
          {isActive && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSendToCheckout(bill)}
                className="btn-primary inline-flex shrink-0 items-center gap-2 px-5 py-2.5 text-sm"
              >
                {t('tables.sendToCheckout')}
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onClearTable(bill)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/60"
                title={t('tables.clearTable')}
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">{t('tables.clearTable')}</span>
              </button>
            </div>
          )}
          {isPaid && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onClearTable(bill)}
                className="btn-primary inline-flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm"
              >
                <Sparkles className="h-4 w-4" />
                {t('payment.clearNow')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Table() {
  const { t } = useTranslation()
  const {
    tables,
    takeOut,
    openPaymentFor,
    openOrderFor,
    addTable,
    transferTable,
    clearTable,
    refreshFloorTables,
  } = usePOS()
  const { refresh: refreshAlerts } = useAlerts()
  const [floorReservations, setFloorReservations] = useState({})
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const [showAddModal, setShowAddModal] = useState(false)
  const [transferSource, setTransferSource] = useState(null)
  const [clearTarget, setClearTarget] = useState(null)
  const [toastMessage, setToastMessage] = useState('')

  const showToast = useCallback((msg) => {
    setToastMessage(msg)
    window.setTimeout(() => setToastMessage(''), 3000)
  }, [])

  const loadFloorReservations = useCallback(async () => {
    const token = getAuthToken()
    if (!token) return

    try {
      const response = await apiFetch('/tables', { token })
      if (response.status === 401) return
      if (response.ok) {
        const data = await response.json()
        setFloorReservations(data?.reservations && typeof data.reservations === 'object' ? data.reservations : {})
        return
      }
      const fallback = await apiFetch('/reservations/floor', { token })
      if (!fallback.ok) return
      const data = await fallback.json()
      setFloorReservations(data?.tables && typeof data.tables === 'object' ? data.tables : {})
    } catch {
      setFloorReservations({})
    }
  }, [])

  useEffect(() => {
    loadFloorReservations()
    const interval = window.setInterval(loadFloorReservations, 30_000)
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') loadFloorReservations()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [loadFloorReservations])

  const standardTables = useMemo(
    () => tables.filter((table) => table.section !== 'vip' && !String(table.name).startsWith('VIP')),
    [tables],
  )
  const vipTables = useMemo(
    () => tables.filter((table) => table.section === 'vip' || String(table.name).startsWith('VIP')),
    [tables],
  )

  const emptyTables = useMemo(() => {
    return tables.filter(
      (t) =>
        (!transferSource || String(t.id) !== String(transferSource.id)) &&
        t.status === 'empty' &&
        (!floorReservations[t.id] || floorReservations[t.id].status !== SEATED_STATUS),
    )
  }, [tables, transferSource, floorReservations])

  const reservedCount = Object.values(floorReservations).filter(
    (reservation) => reservation?.status && reservation.status !== SEATED_STATUS,
  ).length
  const occupiedCount =
    tables.filter((table) => table.status === 'occupied').length + (takeOut.status === 'occupied' ? 1 : 0)
  const paidCount =
    tables.filter((table) => table.status === 'paid').length + (takeOut.status === 'paid' ? 1 : 0)
  const activeCount = occupiedCount

  const handleSendToCheckout = (bill) => {
    openPaymentFor(bill.id)
  }

  const handleOpenOrder = (bill) => {
    openOrderFor(bill.id)
  }

  const handleAddTable = async (data) => {
    await addTable(data)
    showToast(t('tables.tableAdded'))
    await loadFloorReservations()
    refreshAlerts?.()
  }

  const handleTransferTable = async (fromId, toId) => {
    await transferTable(fromId, toId)
    showToast(t('tables.tableTransferred'))
    await loadFloorReservations()
    refreshAlerts?.()
  }

  const handleClearTable = async (targetId) => {
    await clearTable(targetId)
    showToast(t('tables.tableCleared'))
    await loadFloorReservations()
    refreshAlerts?.()
  }

  const handleCheckIn = async () => {
    if (!preview?.id) return
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const response = await apiFetch(`/reservations/${preview.id}/check-in`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('tables.errors.checkIn'))
      setPreview(data)
      await loadFloorReservations()
      refreshAlerts?.()
    } catch (err) {
      setPreviewError(err.message || t('tables.errors.checkIn'))
    } finally {
      setPreviewBusy(false)
    }
  }

  const handleOpenOrderFromReservation = async () => {
    if (!preview) return
    setPreviewBusy(true)
    setPreviewError('')
    try {
      if (canCheckInReservation(preview)) {
        const response = await apiFetch(`/reservations/${preview.id}/check-in`, { method: 'POST' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || t('tables.errors.checkIn'))
        refreshAlerts?.()
      }
      const tableId = preview.table_id
      setPreview(null)
      openOrderFor(tableId)
    } catch (err) {
      setPreviewError(err.message || t('tables.errors.openOrder'))
    } finally {
      setPreviewBusy(false)
    }
  }

  const handleCancelBooking = async () => {
    if (!preview?.id) return
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const response = await apiFetch(`/reservations/${preview.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'Canceled' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('tables.errors.cancelBooking'))
      setPreview(null)
      await loadFloorReservations()
      refreshAlerts?.()
    } catch (err) {
      setPreviewError(err.message || t('tables.errors.cancelBooking'))
    } finally {
      setPreviewBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[80] flex items-center gap-2 rounded-xl bg-forest-800 px-4 py-3 text-sm font-medium text-white shadow-xl animate-in fade-in slide-in-from-top-3">
          <Check className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="page-title">{t('nav.table')}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-semibold shadow-sm"
          >
            <Plus className="h-4 w-4" />
            {t('tables.addTable')}
          </button>
          <div className="badge-olive inline-flex items-center gap-2 self-start px-3 py-1.5 text-sm">
            <LayoutGrid className="h-4 w-4" />
            {t('tables.activeBills', { count: activeCount })}
          </div>
          {paidCount > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 ring-1 ring-teal-300 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800/50">
              <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-300" />
              {t('tables.paidCount', { count: paidCount })}
            </div>
          )}
          {reservedCount > 0 && (
            <div className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800/50">
              {t('tables.reservedNow', { count: reservedCount })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <TakeOutCard
          bill={takeOut}
          onSendToCheckout={handleSendToCheckout}
          onClearTable={setClearTarget}
        />
      </div>

      <div>
        <h4 className="text-heading mb-3 text-sm font-semibold uppercase tracking-wide">{t('tables.standardTables')}</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {standardTables.map((table) => (
            <TableCard
              key={table.id}
              bill={table}
              reservation={floorReservations[table.id] || floorReservations[String(table.id)]}
              onSendToCheckout={handleSendToCheckout}
              onOpenReservation={setPreview}
              onChangeTable={setTransferSource}
              onClearTable={setClearTarget}
              onOpenOrder={handleOpenOrder}
            />
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-heading mb-3 text-sm font-semibold uppercase tracking-wide">{t('tables.vipRooms')}</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {vipTables.map((table) => (
            <TableCard
              key={table.id}
              bill={table}
              reservation={floorReservations[table.id] || floorReservations[String(table.id)]}
              onSendToCheckout={handleSendToCheckout}
              onOpenReservation={setPreview}
              onChangeTable={setTransferSource}
              onClearTable={setClearTarget}
              onOpenOrder={handleOpenOrder}
            />
          ))}
        </div>
      </div>

      <div className="surface-inset flex flex-wrap items-center gap-4 px-5 py-4">
        <p className="text-muted text-xs font-semibold uppercase tracking-wider">{t('tables.statusLegend')}</p>
        {FLOOR_STATUS_KEYS.map((key) => {
          const meta = TABLE_STATUS_META[key]
          return (
            <span key={key} className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.badge}`}>
              {t(meta.labelKey)}
            </span>
          )
        })}
      </div>

      <AddTableModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddTable={handleAddTable}
      />

      <TransferTableModal
        isOpen={Boolean(transferSource)}
        onClose={() => setTransferSource(null)}
        sourceBill={transferSource}
        emptyTables={emptyTables}
        onTransfer={handleTransferTable}
      />

      <ClearTableModal
        isOpen={Boolean(clearTarget)}
        onClose={() => setClearTarget(null)}
        bill={clearTarget}
        onClear={handleClearTable}
      />

      <ReservationPreview
        key={preview?.id || 'closed'}
        reservation={preview}
        busy={previewBusy}
        error={previewError}
        onClose={() => {
          if (previewBusy) return
          setPreview(null)
          setPreviewError('')
        }}
        onCheckIn={handleCheckIn}
        onOpenOrder={handleOpenOrderFromReservation}
        onCancel={handleCancelBooking}
      />
    </div>
  )
}
