import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, DollarSign, Loader2, StickyNote, Tag, Wallet } from 'lucide-react'
import Modal from '../common/Modal'
import { useNotifications } from '../../context/NotificationContext'
import { apiFetch } from '../../services/apiClient'
import { formatOrderDate } from '../../utils/dateTimeFormat'
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from '../../utils/expenseCategories'
import { CategoryMoreMenu } from '../inventory/CategoryChips'
import { PaidFromSelector } from './PaidFrom'
import FieldLabel from '../ui/FieldLabel'
import ModalHeader from '../ui/ModalHeader'

const QUICK_AMOUNTS = [5, 10, 20, 50]

// Up to this many categories show inline; beyond it, the first few stay and the rest go in "More".
const MAX_INLINE_CATEGORIES = 7
const INLINE_WHEN_OVERFLOWING = 5

const SELECTED_CHIP = 'bg-forest-500/15 font-semibold text-forest-800 ring-1 ring-forest-500/50 dark:bg-forest-500/20 dark:text-forest-200'

function todayIso() {
  return formatOrderDate(new Date())
}

function parseIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shiftIsoDate(iso, days) {
  const date = parseIsoDate(iso)
  date.setDate(date.getDate() + days)
  return formatOrderDate(date)
}

function formatChipDate(iso, locale) {
  const date = parseIsoDate(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

/**
 * Quick expense entry used from Stock (next to Stocktake).
 * Saves amount + what it was used for so Dashboard spending/profit stay accurate.
 */
export default function ExpenseLogModal({
  onClose,
  onSaved,
  defaultCategory = 'Inventory Restock',
}) {
  const { t, i18n } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [amountError, setAmountError] = useState('')
  const { pushBanner } = useNotifications()
  const amountRef = useRef(null)
  const [form, setForm] = useState({
    category: defaultCategory,
    description: '',
    amount: '',
    expense_date: todayIso(),
    paid_from: 'drawer',
  })

  const dateRef = useRef(null)
  const [showDateField, setShowDateField] = useState(false)
  const today = todayIso()
  const yesterday = shiftIsoDate(today, -1)
  const pickedOtherDate = form.expense_date !== today && form.expense_date !== yesterday

  const openDatePicker = () => {
    const input = dateRef.current
    if (!input) return
    try {
      input.showPicker()
    } catch {
      // Older browsers: reveal the native field instead.
      setShowDateField(true)
      requestAnimationFrame(() => dateRef.current?.focus())
    }
  }

  const overflowing = EXPENSE_CATEGORIES.length > MAX_INLINE_CATEGORIES
  const inlineCategories = overflowing ? EXPENSE_CATEGORIES.slice(0, INLINE_WHEN_OVERFLOWING) : EXPENSE_CATEGORIES
  const overflowCategories = overflowing ? EXPENSE_CATEGORIES.slice(INLINE_WHEN_OVERFLOWING) : []

  // Runs after Modal's own mount effect, which focuses the panel.
  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    // Enter can fire submit again while a save is still in flight.
    if (saving) return
    // min="0" lets 0 through the browser check; a zero expense is still meaningless.
    if (!(Number(form.amount) > 0)) {
      setAmountError(t('expenses.errors.amount'))
      amountRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          description: form.description,
          amount: Number(form.amount),
          expense_date: form.expense_date,
          paid_from: form.paid_from,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || t('expenses.errors.save'))
      onSaved?.(data)
      pushBanner({ title: t('expenses.saved'), tone: 'success', durationMs: 3000 })
      onClose?.()
    } catch (err) {
      setError(err.message || t('expenses.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      titleId="expense-log-title"
      closeLabel={t('a11y.close')}
      onClose={onClose}
      dismissible={!saving}      maxWidth="max-w-md"
      header={(
        <ModalHeader
          icon={Wallet}
          titleId="expense-log-title"
          title={t('expenses.logExpense')}
          subtitle={t('inventory.expenseHint')}
        />
      )}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary flex-1 text-sm">
            {t('common.cancel')}
          </button>
          {/* Linked via form=, so Enter in any field submits the form. */}
          <button
            type="submit"
            form="expense-log-form"
            disabled={saving}
            aria-busy={saving}
            className={`btn-primary flex-[1.5] text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${saving ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'}`}
          >
            {saving ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('common.saving')}
              </span>
            ) : t('expenses.save')}
          </button>
        </>
      )}
    >
      <form id="expense-log-form" noValidate onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="rounded-2xl bg-slate-100/80 px-4 pb-4 pt-3 text-center dark:bg-zinc-800/60">
          <FieldLabel icon={DollarSign} htmlFor="expense-amount" className="justify-center">
            {t('common.amount')}
          </FieldLabel>
          <div className="mt-1 flex items-center justify-center gap-1">
            <span aria-hidden="true" className="text-[34px] font-medium leading-none text-slate-400 dark:text-zinc-500">$</span>
            <input
              ref={amountRef}
              id="expense-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => {
                setForm({ ...form, amount: e.target.value })
                setAmountError('')
              }}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? 'expense-amount-error' : undefined}
              onWheel={(e) => e.currentTarget.blur()}
              className="w-40 border-0 bg-transparent p-0 text-center text-[34px] font-medium leading-tight tabular-nums text-slate-900 outline-none placeholder:text-slate-300 focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              placeholder="0.00"
            />
          </div>
          {amountError ? (
            <p id="expense-amount-error" role="alert" className="mt-1 text-sm font-medium text-red-600 dark:text-red-400">
              {amountError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {QUICK_AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => {
                  setForm((current) => ({ ...current, amount: String(amount) }))
                  setAmountError('')
                  amountRef.current?.focus()
                }}
                aria-pressed={Number(form.amount) === amount}
                className={`tab-pill min-h-8 px-3 py-1 text-xs ${Number(form.amount) === amount ? 'tab-pill-active' : 'tab-pill-inactive'}`}
              >
                ${amount}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p id="expense-category-label" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            <Tag className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
            {t('common.category')}
          </p>
          <div role="group" aria-labelledby="expense-category-label" className="flex flex-wrap gap-2">
            {inlineCategories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setForm((current) => ({ ...current, category }))}
                aria-pressed={form.category === category}
                className={`tab-pill min-h-9 px-3.5 py-1.5 ${form.category === category ? SELECTED_CHIP : 'tab-pill-inactive'}`}
              >
                {expenseCategoryLabel(category, t)}
              </button>
            ))}
            {overflowCategories.length > 0 ? (
              <CategoryMoreMenu
                categories={overflowCategories}
                activeFilter={form.category}
                onSelect={(category) => setForm((current) => ({ ...current, category }))}
                getLabel={expenseCategoryLabel}
                activeClassName={SELECTED_CHIP}
              />
            ) : null}
          </div>
        </div>

        <PaidFromSelector
          idPrefix="expense-log"
          value={form.paid_from}
          onChange={(paidFrom) => setForm((current) => ({ ...current, paid_from: paidFrom }))}
        />

        <div>
          <p id="expense-date-label" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            <CalendarDays className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
            {t('reservations.date')}
          </p>
          <div role="group" aria-labelledby="expense-date-label" className="flex flex-wrap items-center gap-2">
            {[
              { key: 'today', label: t('expenses.dateToday'), value: today },
              { key: 'yesterday', label: t('expenses.dateYesterday'), value: yesterday },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setForm((current) => ({ ...current, expense_date: option.value }))}
                aria-pressed={form.expense_date === option.value}
                className={`tab-pill min-h-9 px-3.5 py-1.5 ${form.expense_date === option.value ? SELECTED_CHIP : 'tab-pill-inactive'}`}
              >
                {option.label}
              </button>
            ))}
            <div className="relative">
              <button
                type="button"
                onClick={openDatePicker}
                aria-pressed={pickedOtherDate}
                className={`tab-pill inline-flex min-h-9 items-center gap-1.5 px-3.5 py-1.5 ${pickedOtherDate ? SELECTED_CHIP : 'tab-pill-inactive'}`}
              >
                <CalendarDays className="h-4 w-4" />
                {pickedOtherDate ? formatChipDate(form.expense_date, i18n.language) : t('expenses.pickDate')}
              </button>
              {/* Opened through showPicker(); shown as a plain field only where that isn't supported. */}
              <input
                ref={dateRef}
                id="expense-date"
                type="date"
                required
                max={today}
                value={form.expense_date}
                onChange={(e) => {
                  if (e.target.value) setForm((current) => ({ ...current, expense_date: e.target.value }))
                }}
                tabIndex={showDateField ? 0 : -1}
                aria-label={t('expenses.pickDate')}
                className={showDateField ? 'input-field mt-2' : 'pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0'}
              />
            </div>
          </div>
        </div>

        <div>
          <FieldLabel icon={StickyNote} htmlFor="expense-description">
            {t('expenses.noteOptional')}
          </FieldLabel>
          <input
            id="expense-description"
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('expenses.descriptionPlaceholder')}
            className="input-field"
            maxLength={500}
          />
        </div>
      </form>
    </Modal>
  )
}
