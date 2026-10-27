import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, DollarSign, Loader2, Receipt, StickyNote, Store, Tag, Type } from 'lucide-react'
import Modal from '../common/Modal'
import ModalHeader from '../ui/ModalHeader'
import FieldLabel from '../ui/FieldLabel'
import IconSelect from '../ui/IconSelect'
import { apiFetch } from '../../services/apiClient'
import { expenseCategoryLabel } from '../../utils/expenseCategories'
import { toDayKey } from '../../utils/reportRange'
import { formatKhr, formatUsd, khrToUsd, usdToKhr } from '../../utils/currency'
import { useExchangeRate } from '../../hooks/useExchangeRate'
import ExpenseItemsField, { filledItemLines, itemLinesForApi, itemLinesValid, itemsPriceTotal, newItemLine } from './ExpenseItemsField'

// Buying ingredients is where bought items go into stock.
const STOCK_CATEGORY = 'ingredients'

function isStockCategory(categories, categoryId) {
  const category = categories.find((entry) => String(entry.id) === String(categoryId))
  return category?.name?.trim().toLowerCase() === STOCK_CATEGORY
}

function initialForm(expense, categories, rate) {
  if (expense) {
    const inKhr = expense.currency === 'KHR' && expense.amount_khr
    return {
      expense_date: expense.expense_date,
      // A riel expense opens in riel, with the riel that was typed.
      amount: inKhr ? String(expense.amount_khr) : String(expense.amount),
      currency: inKhr ? 'khr' : 'usd',
      category_id: expense.category_id ?? '',
      // Older expenses may have no title; start from what the table shows for them.
      title: expense.title || expense.vendor || expense.note || '',
      vendor: expense.vendor || '',
      note: expense.note || '',
      items: expense.items?.length
        ? expense.items.map((item) => newItemLine(
          item.inventory_id,
          item.quantity,
          item.cost == null ? '' : inKhr ? Math.round(item.cost * rate) : item.cost,
        ))
        : [newItemLine()],
    }
  }
  return {
    expense_date: toDayKey(new Date()),
    amount: '',
    currency: 'usd',
    category_id: categories[0]?.id ?? '',
    title: '',
    vendor: '',
    note: '',
    items: [newItemLine()],
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
function validate(form, t, rate, withItems) {
  // An ingredient purchase is named after its items, so it has no title field.
  const errors = {}
  if (withItems && !filledItemLines(form.items).length) errors.items = t('expenses.form.errors.itemsRequired')
  else if (withItems && !itemLinesValid(form.items)) errors.items = t('expenses.form.errors.items')
  if (!withItems && !form.title.trim()) errors.title = t('expenses.form.errors.title')
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
 * Add or edit one expense: title, category, amount, date, vendor and note, and for Ingredients
 * the items bought, which go into stock.
 * `expense` is null to add. `onSaved(expense)` runs after the API saved it. Fields the form leaves
 * out (payment method, status, receipt, repeat) are not sent: a new expense is paid in
 * cash from the drawer, and editing keeps whatever they were (the API keeps fields it isn't sent).
 */
export default function ExpenseFormModal({ expense = null, categories, onClose, onSaved }) {
  const { t } = useTranslation()
  const rate = useExchangeRate()
  const editing = Boolean(expense)
  const [form, setForm] = useState(() => initialForm(expense, categories, rate))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const ids = { title: useId(), date: useId(), amount: useId(), category: useId(), vendor: useId(), note: useId(), items: useId() }
  // Shown for the Ingredients category, and on an expense that already added items to stock
  // (so changing its category still shows what will be taken back out).
  const hadItems = Boolean(expense?.items?.length)
  const showItems = isStockCategory(categories, form.category_id)
  // Once the items have prices, the amount is their total instead of being typed.
  const priced = showItems ? itemsPriceTotal(form.items) : { entered: false, total: 0 }
  const amountValue = priced.entered
    ? String(form.currency === 'khr' ? Math.round(priced.total) : Math.round(priced.total * 100) / 100)
    : form.amount
  const effective = { ...form, amount: amountValue }
  const toUsd = (value) => (form.currency === 'khr' ? khrToUsd(value, rate) : Math.round(value * 100) / 100)

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    const field = key === 'expense_date' ? 'date' : key === 'category_id' ? 'category' : key
    if (errors[field]) setErrors((current) => ({ ...current, [field]: '' }))
  }

  const updateItems = useCallback((items) => {
    setForm((current) => ({ ...current, items }))
    setErrors((current) => (current.items ? { ...current, items: '' } : current))
  }, [])

  const save = async () => {
    if (saving) return
    const found = validate(effective, t, rate, showItems)
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const body = {
        expense_date: form.expense_date,
        amount: amountInUsd(effective, rate),
        // Keep the riel as typed; amount (dollars) is what totals and reports add up.
        currency: form.currency === 'khr' ? 'KHR' : 'USD',
        ...(form.currency === 'khr' ? { amount_khr: Math.round(Number(amountValue)) } : {}),
        category_id: Number(form.category_id),
        // Empty for Ingredients: the server names it after the items bought.
        title: showItems ? '' : form.title.trim(),
        vendor: form.vendor,
        note: form.note,
      }
      // Items go to stock with this category; moving an expense out of it takes its items back out.
      if (showItems) {
        body.items = itemLinesForApi(form.items, toUsd)
      } else if (hadItems) {
        body.items = []
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
        {/* Ingredient purchases are named after the items bought, so they have no title. */}
        {showItems ? null : (
          <div>
            <FieldLabel icon={Type} htmlFor={ids.title}>
              {t('expenses.form.title')} <span className="text-red-600" aria-hidden>*</span>
            </FieldLabel>
            <input
              id={ids.title}
              value={form.title}
              maxLength={160}
              required
              onChange={(event) => update('title', event.target.value)}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={describedBy('title')}
              className="input-field w-full rounded-xl px-3 py-2 text-sm"
              placeholder={t('expenses.form.titlePlaceholder')}
            />
            <FieldError id={`${ids.title}-error`} message={errors.title} />
          </div>
        )}

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
                      // Switching converts what is typed (amount and item prices), so the money stays the same.
                      const convert = (text) => {
                        const value = Number(text)
                        if (String(text).trim() === '' || !Number.isFinite(value)) return text
                        return option.id === 'khr' ? String(usdToKhr(value, rate)) : String(khrToUsd(value, rate))
                      }
                      // Item prices convert exactly (whole riel, cents), so switching back gives the same price;
                      // rounding each to 100 riel would turn $4.50 into $4.51.
                      const convertPrice = (text) => {
                        const value = Number(text)
                        if (String(text).trim() === '' || !Number.isFinite(value)) return text
                        return option.id === 'khr' ? String(Math.round(value * rate)) : String(Math.round((value / rate) * 100) / 100)
                      }
                      setForm((current) => ({
                        ...current,
                        currency: option.id,
                        amount: convert(current.amount),
                        items: current.items.map((line) => ({ ...line, price: convertPrice(line.price) })),
                      }))
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
              value={amountValue}
              readOnly={priced.entered}
              onChange={(event) => update('amount', event.target.value)}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? `${ids.amount}-error` : `${ids.amount}-hint`}
              className={`input-field w-full rounded-xl px-3 py-2 text-sm tabular-nums ${priced.entered ? 'cursor-default bg-stone-50 font-semibold dark:bg-zinc-800/60' : ''}`}
              placeholder={form.currency === 'khr' ? '0 ៛' : '0.00'}
            />
            {errors.amount ? (
              <FieldError id={`${ids.amount}-error`} message={errors.amount} />
            ) : (
              // What will be saved in the other currency, at the till's rate.
              <p id={`${ids.amount}-hint`} className="text-muted mt-1 text-xs tabular-nums">
                {priced.entered ? `${t('expenses.form.amountFromItems')} · ` : ''}
                {amountInUsd(effective, rate) > 0
                  ? form.currency === 'khr'
                    ? t('expenses.form.inUsd', { amount: formatUsd(amountInUsd(effective, rate)) })
                    : t('expenses.form.inKhr', { amount: formatKhr(usdToKhr(amountInUsd(effective, rate), rate)) })
                  : t('expenses.form.rateHint', { rate: rate.toLocaleString('en-US') })}
              </p>
            )}
          </div>
        </div>

        {showItems ? (
          <ExpenseItemsField
            lines={form.items}
            onChange={updateItems}
            error={errors.items}
            labelId={ids.items}
            currency={form.currency}
          />
        ) : null}

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
