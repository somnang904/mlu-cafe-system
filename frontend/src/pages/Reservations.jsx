import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Armchair,
  Ban,
  Banknote,
  CheckCheck,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  Crown,
  Hourglass,
  ListFilter,
  Pencil,
  Phone,
  Plus,
  ScrollText,
  Search,
  SquarePen,
  StickyNote,
  Tag,
  Trash2,
  User,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ConfirmationLetterModal from '../components/reservations/ConfirmationLetterModal'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import PaginationBar from '../components/ui/PaginationBar'
import Tooltip from '../components/ui/Tooltip'
import OperatingHoursNotice from '../components/common/OperatingHoursNotice'
import PageContainer from '../components/common/PageContainer'
import StatusBadge from '../components/common/StatusBadge'
import FieldLabel from '../components/ui/FieldLabel'
import IconSelect from '../components/ui/IconSelect'
import WheelTimePicker from '../components/ui/WheelTimePicker'
import ModalHeader from '../components/ui/ModalHeader'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import { apiFetch } from '../services/apiClient'
import {
  canCheckInReservation,
  monthRange,
  parseISODate,
  BOOKING_STATUSES,
  RESERVATION_STATUS_META,
  RESERVATION_STATUSES,
  slotLabel,
  toLocalDateISO,
} from '../data/reservations'
import { getTimeSlotsForDate, isMonday, isValidReservationSlot, nextOpenDate } from '../config/siteData'
import { floorTables } from '../data/tables'
import { formatLongDate, formatMonthYear, formatSlotRange12Hour, formatTime12Hour, localizeDigits } from '../utils/dateTimeFormat'
import { canIssueConfirmationLetter } from '../utils/reservationLetter'
import { useAlerts } from '../context/AlertsContext'
import { useNotifications } from '../context/NotificationContext'

const SUMMARY_STATUSES = ['Pending', 'Confirmed', 'Paid', 'Seated']
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DEFAULT_OPEN_DATE = nextOpenDate()
const DEFAULT_SLOTS = getTimeSlotsForDate(DEFAULT_OPEN_DATE)

const STATUS_ICONS = {
  Pending: Hourglass,
  Confirmed: CheckCircle2,
  Paid: Banknote,
}

const EMPTY_FORM = {
  customer_name: '',
  phone: '',
  reservation_date: DEFAULT_OPEN_DATE,
  time_slot: DEFAULT_SLOTS[0]?.value || '09:00',
  table_id: '',
  guest_count: 2,
  status: 'Confirmed',
  notes: '',
}

function bookableTables() {
  return floorTables.filter((table) => !table.isTakeOut)
}

function fallbackAvailability() {
  return bookableTables().map((table) => ({
    id: table.id,
    name: table.name,
    section: table.section,
    capacity: table.capacity,
    available: true,
  }))
}

function floorTableLabel(table, t) {
  if (!table) return t('tables.table')
  if (table.section === 'vip' || String(table.name || '').startsWith('VIP')) {
    const match = String(table.name || '').match(/(\d+)/)
    return t('tables.vipRoomNumber', { number: match ? match[1] : table.id })
  }
  const match = String(table.name || '').match(/(\d+)/)
  return t('tables.tableNumber', { number: match ? match[1] : table.id })
}

function reservationTableLabel(reservation, t) {
  const table =
    floorTables.find((entry) => String(entry.id) === String(reservation.table_id)) ||
    (reservation.table_name
      ? { id: reservation.table_id, name: reservation.table_name, section: String(reservation.table_name).startsWith('VIP') ? 'vip' : 'standard' }
      : null)
  return floorTableLabel(table, t)
}

const SHEET_PAGE_SIZE = 10

function ReservationCalendar({ monthDate, selectedDate, countsByDate, onSelectDate, onChangeMonth }) {
  const { t } = useTranslation()
  const year = monthDate.getFullYear()
  const month = monthDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = toLocalDateISO()
  const cells = []

  for (let i = 0; i < firstDay; i += 1) {
    cells.push(null)
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(day)
  }

  return (
    <div className="surface-card flex h-full min-w-0 flex-col p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t('reservations.calendar')}</p>
          <p className="text-heading mt-0.5 truncate text-lg font-bold">{formatMonthYear(monthDate, t)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onChangeMonth(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-forest-50 hover:text-forest-700 dark:hover:bg-forest-950/40 dark:hover:text-forest-300"
            aria-label={t('reservations.previousMonth')}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeMonth(0)}
            className="rounded-full bg-forest-50 px-3.5 py-1.5 text-xs font-semibold text-forest-700 transition hover:bg-forest-100 dark:bg-forest-950/50 dark:text-forest-300 dark:hover:bg-forest-950"
          >
            {t('reservations.today')}
          </button>
          <button
            type="button"
            onClick={() => onChangeMonth(1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-forest-50 hover:text-forest-700 dark:hover:bg-forest-950/40 dark:hover:text-forest-300"
            aria-label={t('reservations.nextMonth')}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-7 border-b border-border/60 pb-2 text-center text-xs font-semibold text-muted-foreground">
        {WEEKDAY_KEYS.map((day) => (
          <div key={day} className="min-w-0 py-1">
            {t(`dates.weekdaysShort.${day}`)}
          </div>
        ))}
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-7 gap-y-1.5">
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-11" />
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const count = countsByDate[iso] || 0
          const isSelected = selectedDate === iso
          const isToday = today === iso
          const closed = isMonday(iso)
          return (
            <div key={iso} className="flex h-11 items-center justify-center">
              <button
                type="button"
                onClick={() => onSelectDate(iso)}
                aria-label={closed ? `${localizeDigits(day)} - ${t('reservations.closed')}` : undefined}
                aria-pressed={isSelected}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full text-sm tabular-nums transition focus-visible:outline-2 focus-visible:outline-forest-500 ${isSelected
                  ? 'bg-forest-600 font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.4)]'
                  : closed
                    ? 'bg-rose-50 text-rose-400 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300/70 dark:hover:bg-rose-950/50'
                    : isToday
                      ? 'font-bold text-forest-700 ring-2 ring-forest-300 hover:bg-forest-50 dark:text-forest-300 dark:ring-forest-700 dark:hover:bg-forest-950/40'
                      : 'text-foreground hover:bg-forest-50 dark:hover:bg-zinc-800'
                  }`}
              >
                {localizeDigits(day)}
                {count > 0 && !closed ? (
                  <span
                    className={`absolute bottom-1 h-1 w-1 rounded-full ${isSelected ? 'bg-white' : 'bg-violet-500'}`}
                    aria-hidden
                  />
                ) : null}
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" aria-hidden />
          {t('reservations.legendBooked')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-100 ring-1 ring-rose-300 dark:bg-rose-950/50 dark:ring-rose-800" aria-hidden />
          {t('reservations.closed')}
        </span>
      </div>
    </div>
  )
}

function BookingFormModal({ isOpen, mode, form, tables, error, saving, onChange, onClose, onSubmit }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })
  const tableOptions = tables.length ? tables : fallbackAvailability()
  const closedMonday = isMonday(form.reservation_date)
  const timeSlots = closedMonday ? [] : getTimeSlotsForDate(form.reservation_date)
  const tableGroups = [
    {
      label: t('reservations.standardTables'),
      icon: Armchair,
      tables: tableOptions.filter((table) => table.section !== 'vip'),
    },
    {
      label: t('reservations.vipRooms'),
      icon: Crown,
      tables: tableOptions.filter((table) => table.section === 'vip'),
    },
  ].filter((group) => group.tables.length > 0)

  const isPresetSlot = timeSlots.some((slot) => slot.value === form.time_slot)
  const [isCustomTime, setIsCustomTime] = useState(!isPresetSlot && Boolean(form.time_slot))

  useEffect(() => {
    if (!isOpen) {
      setIsCustomTime(false)
    }
  }, [isOpen])

  const statusValues = BOOKING_STATUSES.includes(form.status) ? BOOKING_STATUSES : [...BOOKING_STATUSES, form.status]
  const submitDisabled = saving || closedMonday || !form.table_id || !form.time_slot

  if (!isOpen) return null

  const handleFieldChange = (field) => (event) => {
    onChange(field, event.target.value)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 w-full max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-form-title"
      >
        <div className="modal-panel-body p-4 sm:p-5">
          <ModalHeader
            icon={mode === 'edit' ? Pencil : CalendarPlus}
            title={mode === 'edit' ? t('reservations.editReservation') : t('reservations.newReservation')}
            subtitle={t('reservations.formDescription')}
            titleId="booking-form-title"
            onClose={onClose}
          />

          <form className="mt-3 space-y-2.5" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <FieldLabel icon={User} htmlFor="booking-customer-name">
                  {t('reservations.customerName')}
                </FieldLabel>
                <input
                  id="booking-customer-name"
                  name="customer_name"
                  type="text"
                  autoComplete="name"
                  required
                  value={form.customer_name}
                  onChange={handleFieldChange('customer_name')}
                  className="input-field px-3 py-1.5 text-sm"
                  placeholder={t('reservations.guestNamePlaceholder')}
                />
              </div>
              <div>
                <FieldLabel icon={Phone} htmlFor="booking-phone">
                  {t('reservations.phoneNumber')}
                </FieldLabel>
                <input
                  id="booking-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  required
                  value={form.phone}
                  onChange={handleFieldChange('phone')}
                  className="input-field px-3 py-1.5 text-sm"
                  placeholder="012 345 678"
                />
              </div>
              <div>
                <FieldLabel icon={CalendarDays} htmlFor="booking-date">
                  {t('reservations.date')}
                </FieldLabel>
                <input
                  id="booking-date"
                  type="date"
                  name="reservation_date"
                  required
                  value={form.reservation_date}
                  onChange={handleFieldChange('reservation_date')}
                  className="input-field px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <FieldLabel icon={Clock} htmlFor={isCustomTime ? 'booking-custom-time' : 'booking-time-slot'} className="!mb-0">
                    {t('reservations.timeSlot')}
                  </FieldLabel>
                  <button
                    type="button"
                    onClick={() => {
                      if (isCustomTime) {
                        setIsCustomTime(false)
                        const isPreset = timeSlots.some((s) => s.value === form.time_slot)
                        if (!isPreset && timeSlots.length > 0) {
                          onChange('time_slot', timeSlots[0].value)
                        }
                      } else {
                        setIsCustomTime(true)
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-forest-50 px-2 py-0.5 text-2xs font-semibold text-forest-700 hover:bg-forest-100 dark:bg-forest-950/60 dark:text-forest-300 dark:hover:bg-forest-900 transition-colors"
                  >
                    {isCustomTime ? (
                      <>
                        <ListFilter className="h-3 w-3 shrink-0" />
                        <span>{t('reservations.presetSlots')}</span>
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3 shrink-0" />
                        <span>{t('reservations.wheelTime')}</span>
                      </>
                    )}
                  </button>
                </div>

                {isCustomTime ? (
                  <div className={closedMonday ? 'pointer-events-none opacity-60' : 'space-y-1.5'}>
                    <WheelTimePicker
                      value={form.time_slot || '09:00'}
                      onChange={(nextVal) => onChange('time_slot', nextVal)}
                      disabled={closedMonday}
                    />
                    {form.time_slot ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomTime(false)
                        }}
                        className="w-full flex items-center justify-between gap-2 rounded-xl bg-forest-600 hover:bg-forest-700 active:bg-forest-800 text-white px-3 py-1.5 text-xs font-semibold shadow-md active:scale-[0.99] transition-all cursor-pointer ring-1 ring-forest-500/50"
                        title={t('reservations.selectThisTime')}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-200" />
                          <span className="truncate">{t('reservations.selectThisTime')}</span>
                        </div>
                        <span className="font-mono text-2xs font-bold bg-white/20 px-2 py-0.5 rounded shrink-0">
                          {formatTime12Hour(form.time_slot)}
                        </span>
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className={closedMonday || timeSlots.length === 0 ? 'pointer-events-none opacity-60' : 'space-y-1'}>
                    <IconSelect
                      id="booking-time-slot"
                      value={closedMonday ? '' : String(form.time_slot ?? '')}
                      onChange={(value) => {
                        if (value === '__custom__') {
                          setIsCustomTime(true)
                          return
                        }
                        onChange('time_slot', value)
                      }}
                      placeholder={timeSlots.length === 0 ? t('reservations.closedMondayValidation') : ''}
                      options={[
                        ...(!isPresetSlot && form.time_slot ? [{
                          value: form.time_slot,
                          label: `${formatSlotRange12Hour(form.time_slot, 120)} (${t('reservations.custom')})`,
                          icon: Clock,
                        }] : []),
                        ...timeSlots.map((slot) => ({ value: slot.value, label: slot.label, icon: Clock })),
                        { value: '__custom__', label: `+ ${t('reservations.wheelTime')}...`, icon: Clock },
                      ]}
                      className="rounded-xl"
                    />
                    {!isPresetSlot && form.time_slot ? (
                      <div className="flex items-center justify-between rounded-xl bg-forest-50/80 px-2.5 py-1 text-2xs font-semibold text-forest-800 ring-1 ring-forest-200/80 dark:bg-forest-950/40 dark:text-forest-300 dark:ring-forest-800/60">
                        <div className="flex items-center gap-1.5 truncate">
                          <Clock className="h-3 w-3 shrink-0 text-forest-600 dark:text-forest-400" />
                          <span className="truncate">{formatSlotRange12Hour(form.time_slot, 120)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsCustomTime(true)}
                          className="text-2xs text-forest-600 dark:text-forest-400 hover:underline font-normal shrink-0 ml-1 cursor-pointer"
                        >
                          {t('reservations.changeTime')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div>
                <FieldLabel icon={Armchair} htmlFor="booking-table">
                  {t('reservations.assignedTable')}
                </FieldLabel>
                <IconSelect
                  id="booking-table"
                  value={String(form.table_id ?? '')}
                  onChange={(value) => {
                    const picked = tableOptions.find((table) => String(table.id) === value)
                    if (picked && !picked.available && value !== String(form.table_id)) return
                    onChange('table_id', value)
                  }}
                  placeholder={t('reservations.selectTable')}
                  options={tableGroups.flatMap((group) => [
                    { header: true, label: group.label },
                    ...group.tables.map((table) => ({
                      value: String(table.id),
                      label: floorTableLabel(table, t),
                      hint: !table.available
                        ? t('reservations.bookedSuffix')
                        : t('reservations.seatCount', { count: table.capacity }),
                      icon: group.icon,
                    })),
                  ])}
                  className="rounded-xl"
                />
              </div>
              <div>
                <FieldLabel icon={Users} htmlFor="booking-guest-count">
                  {t('reservations.guestCount')}
                </FieldLabel>
                <input
                  id="booking-guest-count"
                  type="number"
                  name="guest_count"
                  min="1"
                  step="1"
                  required
                  value={form.guest_count}
                  onChange={handleFieldChange('guest_count')}
                  className="input-field px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <FieldLabel icon={Tag} htmlFor="booking-status">
                {t('common.status')}
              </FieldLabel>
              <IconSelect
                id="booking-status"
                value={String(form.status ?? '')}
                onChange={(value) => onChange('status', value)}
                options={statusValues.map((status) => {
                  const meta = RESERVATION_STATUS_META[status]
                  return {
                    value: status,
                    label: meta?.labelKey ? t(meta.labelKey) : status,
                    icon: STATUS_ICONS[status] || CircleDot,
                  }
                })}
                className="rounded-xl"
              />
            </div>

            <div>
              <FieldLabel icon={StickyNote} htmlFor="booking-notes">
                {t('reservations.specialRequests')}
              </FieldLabel>
              <textarea
                id="booking-notes"
                name="notes"
                value={form.notes}
                onChange={handleFieldChange('notes')}
                rows={2}
                className="input-field px-3 py-1.5 text-sm min-h-[46px] max-h-[70px] resize-none"
                placeholder={t('reservations.notesPlaceholder')}
              />
            </div>

            {closedMonday ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-2xs font-medium text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
                {t('reservations.closedMondayBooking')}
              </p>
            ) : (
              <OperatingHoursNotice className="!py-1 !px-2.5 !text-2xs !rounded-xl" />
            )}

            {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

            <div className="flex gap-2.5 pt-1">
              <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2 text-sm">
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={submitDisabled}
                className={`btn-primary flex-1 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${submitDisabled ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'
                  }`}
              >
                {saving
                  ? t('common.saving')
                  : mode === 'edit'
                    ? t('common.saveChanges')
                    : t('reservations.createBooking')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function ReservationActions({
  reservation,
  checkingInId,
  onCheckIn,
  onLetter,
  onEdit,
  onDelete,
  onStatus,
  touch = false,
}) {
  const { t } = useTranslation()
  const iconButton = `flex shrink-0 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-forest-500 ${touch ? 'h-10 w-10' : 'h-8 w-8'
    }`
  const canLetter = canIssueConfirmationLetter(reservation)
  const isHeld = ['Pending', 'Confirmed', 'Paid'].includes(reservation.status)
  const isPastOrToday = String(reservation.reservation_date || '') <= toLocalDateISO()
  const statusActions = [
    reservation.status === 'Seated' && { key: 'Completed', icon: CheckCheck, label: t('reservations.actionComplete'), tone: 'hover:bg-forest-50 hover:text-forest-600 dark:hover:bg-forest-950/50 dark:hover:text-forest-300' },
    isHeld && isPastOrToday && { key: 'No-show', icon: UserX, label: t('reservations.actionNoShow'), tone: 'hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/50 dark:hover:text-amber-300' },
    isHeld && { key: 'Canceled', icon: Ban, label: t('reservations.actionCancel'), tone: 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400' },
  ].filter(Boolean)

  return (
    <div className={`flex items-center gap-2 ${touch ? 'flex-wrap' : 'flex-nowrap'}`}>
      {canCheckInReservation(reservation) ? (
        <button
          type="button"
          disabled={checkingInId === reservation.id}
          onClick={() => onCheckIn(reservation)}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 ${touch ? 'min-h-10 px-3 text-sm' : 'px-2.5 py-1 text-2xs'
            }`}
          aria-label={t('a11y.checkInGuest', { name: reservation.customer_name })}
        >
          <UserCheck className={touch ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
          {checkingInId === reservation.id ? '…' : t('reservations.checkIn')}
        </button>
      ) : null}
      <div className="flex w-fit items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
        {statusActions.map((action) => {
          const ActionIcon = action.icon
          return (
            <span key={action.key} className="flex items-center gap-0.5">
              <Tooltip label={action.label}>
                <button
                  type="button"
                  onClick={() => onStatus(reservation, action.key)}
                  className={`${iconButton} text-slate-500 dark:text-zinc-400 ${action.tone}`}
                  aria-label={`${action.label}: ${reservation.customer_name}`}
                >
                  <ActionIcon className="h-4 w-4" aria-hidden />
                </button>
              </Tooltip>
              <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
            </span>
          )
        })}
        <Tooltip label={canLetter ? t('reservations.confirmationLetter') : t('reservations.confirmationUnavailableCanceled')}>
          <button
            type="button"
            disabled={!canLetter}
            onClick={() => onLetter(reservation)}
            className={`${iconButton} text-slate-500 hover:bg-forest-50 hover:text-forest-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300`}
            aria-label={t('a11y.confirmationLetterFor', { name: reservation.customer_name })}
          >
            <ScrollText className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
        <Tooltip label={t('common.edit')}>
          <button
            type="button"
            onClick={() => onEdit(reservation)}
            className={`${iconButton} text-slate-500 hover:bg-forest-50 hover:text-forest-600 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300`}
            aria-label={t('a11y.editGuest', { name: reservation.customer_name })}
          >
            <SquarePen className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
        <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
        <Tooltip label={t('common.delete')}>
          <button
            type="button"
            onClick={() => onDelete(reservation)}
            className={`${iconButton} text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400`}
            aria-label={t('a11y.deleteGuest', { name: reservation.customer_name })}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export default function Reservations() {
  const { t } = useTranslation()
  const { refresh: refreshAlerts } = useAlerts()
  const { pushBanner } = useNotifications()
  const today = toLocalDateISO()
  const [monthDate, setMonthDate] = useState(() => parseISODate(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [reservations, setReservations] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sheetPage, setSheetPage] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalMode, setModalMode] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [availability, setAvailability] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [letterReservation, setLetterReservation] = useState(null)
  const [checkingInId, setCheckingInId] = useState(null)

  const range = useMemo(
    () => monthRange(monthDate.getFullYear(), monthDate.getMonth()),
    [monthDate],
  )

  const loadReservations = useCallback(async (customRange) => {
    const activeRange = customRange?.from && customRange?.to ? customRange : range
    try {
      const response = await apiFetch(`/reservations?from=${activeRange.from}&to=${activeRange.to}`)
      const data = await response.json().catch(() => [])
      if (!response.ok) throw new Error(data.message || t('reservations.errors.load'))
      setReservations(Array.isArray(data) ? data : [])
      setError('')
    } catch (err) {
      setError(err.message || t('reservations.errors.load'))
      setReservations([])
    } finally {
      setIsLoading(false)
    }
  }, [range, t])

  useEffect(() => {
    setIsLoading(true)
    loadReservations()
  }, [loadReservations])

  const loadAvailability = useCallback(async (date, timeSlot, excludeId) => {
    if (!date || !timeSlot || isMonday(date)) {
      setAvailability(fallbackAvailability())
      return
    }
    try {
      const params = new URLSearchParams({ date, time_slot: timeSlot })
      if (excludeId) params.set('exclude_id', String(excludeId))
      const response = await apiFetch(`/reservations/availability?${params}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('reservations.errors.availability'))
      setAvailability(Array.isArray(data.tables) ? data.tables : [])
    } catch {
      setAvailability(fallbackAvailability())
    }
  }, [t])

  useEffect(() => {
    if (!modalMode) return undefined
    loadAvailability(form.reservation_date, form.time_slot, editing?.id)
    return undefined
  }, [modalMode, form.reservation_date, form.time_slot, editing?.id, loadAvailability])

  const countsByDate = useMemo(() => {
    const counts = {}
    for (const reservation of reservations) {
      if (reservation.status === 'Canceled') continue
      counts[reservation.reservation_date] = (counts[reservation.reservation_date] || 0) + 1
    }
    return counts
  }, [reservations])

  const sheetRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return reservations.filter((reservation) => {
      if (reservation.reservation_date !== selectedDate) return false
      if (statusFilter !== 'all' && reservation.status !== statusFilter) return false
      if (!query) return true
      return [reservation.customer_name, reservation.phone, reservation.table_name, reservation.notes]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [reservations, selectedDate, statusFilter, search])

  const sheetPageCount = Math.max(1, Math.ceil(sheetRows.length / SHEET_PAGE_SIZE))
  const activeSheetPage = Math.min(sheetPage, sheetPageCount - 1)
  const pagedRows = useMemo(
    () => sheetRows.slice(activeSheetPage * SHEET_PAGE_SIZE, (activeSheetPage + 1) * SHEET_PAGE_SIZE),
    [sheetRows, activeSheetPage],
  )

  const selectedDayCount = countsByDate[selectedDate] || 0

  const statusFilterOptions = [
    { value: 'all', label: t('reservations.allStatuses'), icon: ListFilter },
    ...RESERVATION_STATUSES.map((status) => {
      const meta = RESERVATION_STATUS_META[status]
      return {
        value: status,
        label: meta?.labelKey ? t(meta.labelKey) : status,
        icon: STATUS_ICONS[status] || CircleDot,
      }
    }),
  ]
  const emptyMessage = isLoading
    ? t('reservations.loading')
    : sheetRows.length === 0
      ? t('reservations.emptyFiltered')
      : ''

  const activeRowsForSummary = useMemo(
    () => reservations.filter((row) => row.reservation_date === selectedDate),
    [reservations, selectedDate],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, reservation_date: selectedDate || today })
    setFormError('')
    setAvailability(fallbackAvailability())
    setModalMode('create')
  }

  const openEdit = (reservation) => {
    const date = reservation.reservation_date
    const currentSlot = String(reservation.time_slot).slice(0, 5)
    setEditing(reservation)
    setForm({
      customer_name: reservation.customer_name,
      phone: reservation.phone,
      reservation_date: date,
      time_slot: currentSlot,
      table_id: String(reservation.table_id),
      guest_count: reservation.guest_count,
      status: reservation.status,
      notes: reservation.notes || '',
    })
    setFormError('')
    setAvailability(fallbackAvailability())
    setModalMode('edit')
  }

  const handleFormChange = useCallback((field, value) => {
    setForm((prev) => {
      if (field !== 'reservation_date') return { ...prev, [field]: value }
      const slots = getTimeSlotsForDate(value)
      const nextSlot = isValidReservationSlot(value, prev.time_slot)
        ? prev.time_slot
        : slots[0]?.value || prev.time_slot || ''
      return { ...prev, reservation_date: value, time_slot: nextSlot }
    })
  }, [])

  const closeBookingModal = useCallback(() => {
    setModalMode(null)
    setFormError('')
  }, [])

  const handleCheckIn = async (reservation) => {
    if (!canCheckInReservation(reservation)) return
    setCheckingInId(reservation.id)
    setError('')
    try {
      const response = await apiFetch(`/reservations/${reservation.id}/check-in`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('reservations.errors.checkIn'))
      setReservations((prev) => prev.map((row) => (row.id === data.id ? data : row)))
      refreshAlerts?.()
    } catch (err) {
      setError(err.message || t('reservations.errors.checkIn'))
    } finally {
      setCheckingInId(null)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isMonday(form.reservation_date)) {
      setFormError(t('reservations.closedMondayValidation'))
      return
    }
    if (!isValidReservationSlot(form.reservation_date, form.time_slot)) {
      setFormError(t('reservations.invalidTimeSlot'))
      return
    }
    setSaving(true)
    setFormError('')
    const isEdit = modalMode === 'edit'
    const payload = {
      ...form,
      table_id: Number.parseInt(form.table_id, 10),
      guest_count: Number.parseInt(form.guest_count, 10),
    }
    try {
      const path = isEdit && editing ? `/reservations/${editing.id}` : '/reservations'
      const response = await apiFetch(path, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('reservations.errors.save'))
      setModalMode(null)
      setEditing(null)

      const bookedDateStr = data?.reservation_date || payload.reservation_date
      if (bookedDateStr) {
        const [y, m] = bookedDateStr.split('-').map(Number)
        if (y && m) {
          const targetMonth = new Date(y, m - 1, 1)
          const targetRange = monthRange(y, m - 1)
          setMonthDate(targetMonth)
          setSelectedDate(bookedDateStr)
          await loadReservations(targetRange)
        } else {
          await loadReservations()
        }
      } else {
        await loadReservations()
      }

      pushBanner?.({
        title: isEdit ? t('reservations.bookingUpdated') : t('reservations.bookingCreated'),
        message: `${payload.customer_name} — ${bookedDateStr} (${payload.time_slot})`,
        tone: 'success',
      })
      refreshAlerts?.()
    } catch (err) {
      setFormError(err.message || t('reservations.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const applyStatus = async (reservation, status) => {
    setError('')
    try {
      const response = await apiFetch(`/reservations/${reservation.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('reservations.errors.save'))
      pushBanner({ title: t('reservations.statusUpdated'), tone: 'success', durationMs: 2500 })
      await loadReservations()
      refreshAlerts?.()
    } catch (err) {
      setError(err.message || t('reservations.errors.save'))
    }
  }

  const requestStatus = (reservation, status) => {
    if (status === 'Completed') {
      applyStatus(reservation, status)
      return
    }
    setStatusTarget({ reservation, status })
  }

  const confirmStatus = async () => {
    const target = statusTarget
    setStatusTarget(null)
    if (target) await applyStatus(target.reservation, target.status)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const response = await apiFetch(`/reservations/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('reservations.errors.delete'))
      setDeleteTarget(null)
      await loadReservations()
    } catch (err) {
      setError(err.message || t('reservations.errors.delete'))
      setDeleteTarget(null)
    }
  }

  const handleChangeMonth = (direction) => {
    if (direction === 0) {
      const now = parseISODate(today)
      setMonthDate(now)
      setSelectedDate(today)
      setSheetPage(0)
      return
    }
    const next = new Date(monthDate.getFullYear(), monthDate.getMonth() + direction, 1)
    setMonthDate(next)
    const selected = parseISODate(selectedDate)
    if (selected.getMonth() !== next.getMonth() || selected.getFullYear() !== next.getFullYear()) {
      setSelectedDate(toLocalDateISO(next))
    }
  }

  return (
    <PageContainer className="space-y-6">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3 className="min-w-0 break-words text-heading text-lg">{t('nav.reservations')}</h3>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary beam-border inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)]"
        >
          <Plus className="h-4 w-4" />
          {t('reservations.newBooking')}
        </button>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
        <ReservationCalendar
          monthDate={monthDate}
          selectedDate={selectedDate}
          countsByDate={countsByDate}
          onSelectDate={(iso) => {
            setSelectedDate(iso)
            setSheetPage(0)
          }}
          onChangeMonth={handleChangeMonth}
        />

        <div className="surface-card flex h-full min-w-0 flex-col p-5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" />
              <p className="min-w-0 break-words text-heading text-sm font-semibold">
                {formatLongDate(parseISODate(selectedDate), t)}
              </p>
            </div>
          </div>
          <p className="text-muted mt-2 break-words text-sm">
            {isMonday(selectedDate) ? (
              t('reservations.unavailableOnDate')
            ) : selectedDayCount === 0 ? (
              t('reservations.noneOnDate')
            ) : (
              t('reservations.bookingCount', { count: selectedDayCount })
            )}
          </p>
          <div className="mt-auto grid w-full grid-cols-2 gap-2.5 pt-4 sm:grid-cols-4">
            {SUMMARY_STATUSES.map((status) => {
              const count = activeRowsForSummary.filter((row) => row.status === status).length
              const meta = RESERVATION_STATUS_META[status]
              return (
                <div key={status} className="flex h-full min-w-0 flex-col rounded-2xl border border-border px-3 py-3">
                  <p className="text-muted break-words text-2xs font-semibold uppercase leading-tight tracking-wide">
                    {t(meta?.labelKey || status)}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{localizeDigits(count)}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="surface-card min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border/60 px-5 py-4">
          <p className="shrink-0 text-heading text-sm font-semibold">{t('reservations.sheet')}</p>
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" aria-hidden />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setSheetPage(0)
              }}
              placeholder={t('reservations.searchPlaceholder')}
              className="input-field w-full min-w-0 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="w-full shrink-0 sm:w-52">
            <IconSelect
              value={statusFilter}
              options={statusFilterOptions}
              onChange={(value) => {
                setStatusFilter(value)
                setSheetPage(0)
              }}
              className="w-full px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error ? <p className="break-words px-5 py-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {emptyMessage ? (
          <p className="px-5 py-10 text-center text-muted-foreground lg:hidden">{emptyMessage}</p>
        ) : null}
        <>
          <div className="lg:hidden">
            {pagedRows.map((reservation) => {
              const meta = RESERVATION_STATUS_META[reservation.status] || RESERVATION_STATUS_META.Pending
              return (
                <article key={reservation.id} className="min-w-0 border-b border-border/60 px-4 py-4 last:border-b-0">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <p className="min-w-0 break-words font-medium">{reservation.customer_name}</p>
                    <StatusBadge className={`shrink-0 ring-1 ${meta.badge}`}>
                      {t(meta.labelKey)}
                    </StatusBadge>
                  </div>
                  <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div className="min-w-0">
                      <dt className="text-muted text-2xs">{t('reservations.date')}</dt>
                      <dd className="break-words tabular-nums">{reservation.reservation_date}</dd>
                    </div>
<div className="min-w-0">
                      <dt className="text-muted text-2xs">{t('reservations.timeSlot')}</dt>
                      <dd className="break-words">
                        {slotLabel(reservation.time_slot, reservation.time_slot_label, reservation.duration_minutes)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted text-2xs">{t('reservations.phoneNumber')}</dt>
                      <dd className="break-words">{reservation.phone}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted text-2xs">{t('reservations.guestCount')}</dt>
                      <dd className="tabular-nums">{reservation.guest_count}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted text-2xs">{t('tables.table')}</dt>
                      <dd className="break-words">{reservationTableLabel(reservation, t)}</dd>
                    </div>
                  </dl>
                  {reservation.status === 'Seated' && reservation.checked_in_at ? (
                    <p className="text-muted mt-2 text-2xs">
                      {t('reservations.checkedInAt', { time: formatTime12Hour(reservation.checked_in_at) })}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <ReservationActions
                      reservation={reservation}
                      checkingInId={checkingInId}
                      onCheckIn={handleCheckIn}
                      onLetter={setLetterReservation}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                      onStatus={requestStatus}
                      touch
                    />
                  </div>
                  {reservation.status === 'Seated' && reservation.checked_in_at ? (
                    <p className="text-muted mt-2 text-2xs">
                      {t('reservations.checkedInAt', { time: formatTime12Hour(reservation.checked_in_at) })}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <ReservationActions
                      reservation={reservation}
                      checkingInId={checkingInId}
                      onCheckIn={handleCheckIn}
                      onLetter={setLetterReservation}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                      touch
                    />
                  </div>
                </article>
              )
            })}
          </div>

          <div className="hidden min-h-[37.5rem] overflow-x-auto lg:block">
            <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
              <thead className="bg-olive-50/70 text-xs uppercase tracking-wide text-muted-foreground dark:bg-zinc-900/60">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('reservations.date')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('reservations.timeSlot')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('reservations.customerName')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('reservations.phoneNumber')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('reservations.guestCount')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('tables.table')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('common.status')}</th>
                  <th className="whitespace-nowrap px-4 py-3 font-semibold">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {emptyMessage ? (
                  <tr>
                    <td colSpan={8} className="h-[34rem] px-5 text-center text-muted-foreground">
                      {emptyMessage}
                    </td>
                  </tr>
                ) : null}
                {pagedRows.map((reservation) => {
                  const meta = RESERVATION_STATUS_META[reservation.status] || RESERVATION_STATUS_META.Pending
                  return (
                    <tr
                      key={reservation.id}
                      className="align-middle transition-colors even:bg-slate-50 hover:bg-slate-100/80 dark:even:bg-zinc-900/30 dark:hover:bg-zinc-800/60"
                    >
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums">{reservation.reservation_date}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {slotLabel(
                          reservation.time_slot,
                          reservation.time_slot_label,
                          reservation.duration_minutes,
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-medium">{reservation.customer_name}</td>
                      <td className="whitespace-nowrap px-4 py-4">{reservation.phone}</td>
                      <td className="whitespace-nowrap px-4 py-4 tabular-nums">{reservation.guest_count}</td>
                      <td className="whitespace-nowrap px-4 py-4">{reservationTableLabel(reservation, t)}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <StatusBadge className={`ring-1 ${meta.badge}`}>
                          {t(meta.labelKey)}
                        </StatusBadge>
                        {reservation.status === 'Seated' && reservation.checked_in_at ? (
                          <span className="text-muted mt-1 block text-2xs">
                            {t('reservations.checkedInAt', { time: formatTime12Hour(reservation.checked_in_at) })}
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <ReservationActions
                          reservation={reservation}
                          checkingInId={checkingInId}
                          onCheckIn={handleCheckIn}
                          onLetter={setLetterReservation}
                          onEdit={openEdit}
                          onDelete={setDeleteTarget}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>

        <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted shrink-0 text-xs tabular-nums">
            {t('reservations.showingRange', {
              from: localizeDigits(sheetRows.length === 0 ? 0 : activeSheetPage * SHEET_PAGE_SIZE + 1),
              to: localizeDigits(Math.min((activeSheetPage + 1) * SHEET_PAGE_SIZE, sheetRows.length)),
              total: localizeDigits(sheetRows.length),
            })}
          </p>
          <PaginationBar
            alwaysShow
            currentPage={activeSheetPage}
            totalPages={sheetPageCount}
            onPageChange={setSheetPage}
            className="sm:min-w-[22rem]"
          />
        </div>
      </div>

      <BookingFormModal
        isOpen={Boolean(modalMode)}
        mode={modalMode}
        form={form}
        tables={availability}
        error={formError}
        saving={saving}
        onChange={handleFormChange}
        onClose={closeBookingModal}
        onSubmit={handleSubmit}
      />

      <ConfirmationLetterModal
        isOpen={Boolean(letterReservation)}
        reservation={letterReservation}
        onClose={() => setLetterReservation(null)}
      />

      <ConfirmDeleteModal
        isOpen={Boolean(statusTarget)}
        title={statusTarget?.status === 'No-show' ? t('reservations.noShowTitle') : t('reservations.cancelTitle')}
        itemName={statusTarget?.reservation?.customer_name}
        message={statusTarget?.status === 'No-show' ? t('reservations.noShowMessage') : t('reservations.cancelMessage')}
        confirmLabel={statusTarget?.status === 'No-show' ? t('reservations.actionNoShow') : t('reservations.actionCancel')}
        onCancel={() => setStatusTarget(null)}
        onConfirm={confirmStatus}
      />

      <ConfirmDeleteModal
        isOpen={Boolean(deleteTarget)}
        title={t('reservations.deleteTitle')}
        itemName={deleteTarget?.customer_name}
        message={t('reservations.deleteMessage')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </PageContainer>
  )
}
