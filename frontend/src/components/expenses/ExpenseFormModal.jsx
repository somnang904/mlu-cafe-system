import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Banknote,
  Calendar,
  CircleCheck,
  CreditCard,
  DollarSign,
  Landmark,
  Loader2,
  QrCode,
  Receipt,
  StickyNote,
  Store,
  Tag,
  Type,
  Wallet,
} from 'lucide-react'
import Modal from '../common/Modal'
import ModalHeader from '../ui/ModalHeader'
import FieldLabel from '../ui/FieldLabel'
import IconSelect from '../ui/IconSelect'
import { apiFetch } from '../../services/apiClient'
import { expenseCategoryLabel, EXPENSE_METHODS } from '../../utils/expenseCategories'
import { toDayKey } from '../../utils/reportRange'
import { formatKhr, formatUsd, khrToUsd, usdToKhr } from '../../utils/currency'
import { useExchangeRate } from '../../hooks/useExchangeRate'

export const METHOD_ICONS = { cash: Banknote, aba_khqr: QrCode, card: CreditCard, bank_transfer: Landmark }

function initialForm(expense, categories) {
  if (expense) {
    return {
      expense_date: expense.expense_date,
      amount: String(expense.amount),
      currency: 'usd',
      category_id: expense.category_id ?? '',
      title: expense.title || '',
      vendor: expense.vendor || '',
      method: expense.method || 'cash',
      status: expense.status || 'paid',
      note: expense.note || '',
    }
  }
  return {
    expense_date: toDayKey(new Date()),
    amount: '',
    currency: 'usd',
    category_id: categories[0]?.id ?? '',
    title: '',
    vendor: '',
    method: 'cash',
    status: 'paid',
    note: '',
  }
}

/**
 * The amount in dollars, which is what is stored. Riel is converted at the shop's rate
 * (the same one the till uses); null when the field is empty or not a number.
 */
function amountInUsd(form, rate) {
  if (form.amount === '') return null
  const value = Number(form.amount)
  if (!Number.isFinite(value)) return null
  return form.currency === 'khr' ? khrToUsd(value, rate) : Math.round(value * 100) / 100
}

/** The client-side checks; the server repeats them and answers with the field that is wrong. */
function validate(form, t, rate) {
  const errors = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expense_date)) errors.date = t('expenses.form.errors.date')
  const amount = amountInUsd(form, rate)
  if (amount == null || amount <= 0) {
    errors.amount = form.currency === 'khr' ? t('expenses.form.errors.amountKhr') : t('expenses.form.errors.amount')
  }
  if (!form.category_id) errors.category = t('expenses.form.errors.category')
  return errors
}

function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  )
}

/**
 * Add or edit one expense. `expense` is null to add. `onSaved(expense)` runs after the API saved it.
 * The form leaves out "paid from", the receipt photo and "repeat monthly": a new cash expense comes
 * from the cash drawer, and editing keeps whatever those were (the API keeps fields it isn't sent).
 */
export default function ExpenseFormModal({ expense = null, categories, onClose, onSaved }) {
  const { t } = useTranslation()
  const rate = useExchangeRate()
  const editing = Boolean(expense)
  const [form, setForm] = useState(() => initialForm(expense, categories))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const ids = { title: useId(), date: useId(), amount: useId(), category: useId(), vendor: useId(), method: useId(), note: useId() }

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    const field = key === 'expense_date' ? 'date' : key === 'category_id' ? 'category' : key
    if (errors[field]) setErrors((current) => ({ ...current, [field]: '' }))
  }

  const save = async () => {
    if (saving) return
    const found = validate(form, t, rate)
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const body = {
        expense_date: form.expense_date,
        amount: amountInUsd(form, rate),
        category_id: Number(form.category_id),
        title: form.title,
        vendor: form.vendor,
        method: form.method,
        status: form.status,
        note: form.note,
      }
      const response = await apiFetch(editing ? `/expenses/${expense.id}` : '/expenses', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.field) setErrors((current) => ({ ...current, [data.field]: data.message }))
        else setFormError(data.message || t('expenses.errors.save'))
        return
      }
      onSaved(data)
    } catch (error) {
      setFormError(error.message || t('expenses.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const title = editing ? t('expenses.form.editTitle') : t('expenses.form.addTitle')
  const describedBy = (field) => (errors[field] ? `${ids[field]}-error` : undefined)

  return (
    <Modal
      title={title}
      titleId="expense-form-title"
      header={<ModalHeader icon={Receipt} titleId="expense-form-title" title={title} />}
      onClose={onClose}
      closeLabel={t('a11y.closeModal')}
      dismissible={!saving}
      maxWidth="max-w-xl"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary flex-1 py-2.5 text-sm">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="expense-form"
            disabled={saving}
            className="btn-primary beam-border inline-flex flex-1 items-center justify-center gap-2 py-2.5 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)] disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t('expenses.save')}
          </button>
        </>
      )}
    >
      <form
        id="expense-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        className="space-y-4"
      >
        <div>
          <FieldLabel icon={Type} htmlFor={ids.title}>
            {t('expenses.form.title')}
          </FieldLabel>
          <input
            id={ids.title}
            value={form.title}
            maxLength={160}
            onChange={(event) => update('title', event.target.value)}
            className="input-field w-full rounded-xl px-3 py-2 text-sm"
            placeholder={t('expenses.form.titlePlaceholder')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel icon={Calendar} htmlFor={ids.date}>
              {t('expenses.form.date')} <span className="text-red-600" aria-hidden>*</span>
            </FieldLabel>
            <input
              id={ids.date}
              type="date"
              required
              value={form.expense_date}
              onChange={(event) => update('expense_date', event.target.value)}
              aria-invalid={errors.date ? true : undefined}
              aria-describedby={describedBy('date')}
              className="input-field w-full rounded-xl px-3 py-2 text-sm"
            />
            <FieldError id={`${ids.date}-error`} message={errors.date} />
          </div>
          <div>
            <div className="flex items-start justify-between gap-2">
              <FieldLabel icon={DollarSign} htmlFor={ids.amount}>
                {t('expenses.form.amount')} <span className="text-red-600" aria-hidden>*</span>
              </FieldLabel>
              <div role="radiogroup" aria-label={t('expenses.form.currency')} className="-mt-1 flex gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-zinc-800">
                {[
                  { id: 'usd', label: '$' },
                  { id: 'khr', label: '៛' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={form.currency === option.id}
                    aria-label={t(`expenses.form.currencies.${option.id}`)}
                    onClick={() => {
                      if (form.currency === option.id) return
                      // Switching converts what is typed, so the amount stays the same.
                      const value = Number(form.amount)
                      const converted = form.amount === '' || !Number.isFinite(value)
                        ? form.amount
                        : option.id === 'khr'
                          ? String(usdToKhr(value, rate))
                          : String(khrToUsd(value, rate))
                      setForm((current) => ({ ...current, currency: option.id, amount: converted }))
                    }}
                    className={`h-6 min-w-7 rounded-md px-2 text-xs font-bold transition ${
                      form.currency === option.id
                        ? 'bg-white text-forest-700 shadow-sm dark:bg-zinc-700 dark:text-forest-300'
                        : 'text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <input
              id={ids.amount}
              type="number"
              inputMode={form.currency === 'khr' ? 'numeric' : 'decimal'}
              min={form.currency === 'khr' ? '100' : '0.01'}
              step={form.currency === 'khr' ? '100' : '0.01'}
              required
              value={form.amount}
              onChange={(event) => update('amount', event.target.value)}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? `${ids.amount}-error` : `${ids.amount}-hint`}
              className="input-field w-full rounded-xl px-3 py-2 text-sm tabular-nums"
              placeholder={form.currency === 'khr' ? '0 ៛' : '0.00'}
            />
            {errors.amount ? (
              <FieldError id={`${ids.amount}-error`} message={errors.amount} />
            ) : (
              // What will be saved in the other currency, at the till's rate.
              <p id={`${ids.amount}-hint`} className="text-muted mt-1 text-xs tabular-nums">
                {amountInUsd(form, rate) > 0
                  ? form.currency === 'khr'
                    ? t('expenses.form.inUsd', { amount: formatUsd(amountInUsd(form, rate)) })
                    : t('expenses.form.inKhr', { amount: formatKhr(usdToKhr(amountInUsd(form, rate), rate)) })
                  : t('expenses.form.rateHint', { rate: rate.toLocaleString('en-US') })}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel icon={Tag} htmlFor={ids.category}>
              {t('expenses.form.category')} <span className="text-red-600" aria-hidden>*</span>
            </FieldLabel>
            <IconSelect
              id={ids.category}
              value={form.category_id}
              onChange={(value) => update('category_id', value)}
              placeholder={t('expenses.form.chooseCategory')}
              options={categories.map((category) => ({
                value: category.id,
                label: expenseCategoryLabel(category.name, t),
              }))}
            />
            <FieldError id={`${ids.category}-error`} message={errors.category} />
          </div>
          <div>
            <FieldLabel icon={Store} htmlFor={ids.vendor}>
              {t('expenses.form.vendor')}
            </FieldLabel>
            <input
              id={ids.vendor}
              value={form.vendor}
              maxLength={160}
              onChange={(event) => update('vendor', event.target.value)}
              className="input-field w-full rounded-xl px-3 py-2 text-sm"
              placeholder={t('expenses.form.vendorPlaceholder')}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel icon={Wallet} htmlFor={ids.method}>
              {t('expenses.form.method')}
            </FieldLabel>
            <IconSelect
              id={ids.method}
              value={form.method}
              onChange={(value) => update('method', value)}
              options={EXPENSE_METHODS.map((method) => ({
                value: method,
                label: t(`expenses.methods.${method}`),
                icon: METHOD_ICONS[method],
              }))}
            />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              <CircleCheck className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
              {t('expenses.form.status')}
            </p>
            <div role="radiogroup" aria-label={t('expenses.form.status')} className="grid grid-cols-2 gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-zinc-800">
              {['paid', 'unpaid'].map((status) => (
                <button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={form.status === status}
                  onClick={() => update('status', status)}
                  className={`min-h-9 rounded-md px-2 py-1.5 text-sm font-medium transition ${
                    form.status === status
                      ? 'bg-white text-forest-700 shadow-sm dark:bg-zinc-700 dark:text-forest-300'
                      : 'text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  {t(`expenses.status.${status}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <FieldLabel icon={StickyNote} htmlFor={ids.note}>
            {t('expenses.form.note')}
          </FieldLabel>
          <textarea
            id={ids.note}
            rows={2}
            maxLength={500}
            value={form.note}
            onChange={(event) => update('note', event.target.value)}
            className="input-field w-full resize-y rounded-xl px-3 py-2 text-sm"
            placeholder={t('expenses.descriptionPlaceholder')}
          />
        </div>

        {formError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p> : null}
      </form>
    </Modal>
  )
}
