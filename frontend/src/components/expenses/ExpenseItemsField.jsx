import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Package, Plus, Sparkles, X } from 'lucide-react'
import FieldLabel from '../ui/FieldLabel'
import { apiFetch } from '../../services/apiClient'
import { formatKhr, formatUsd } from '../../utils/currency'
import ItemCombobox from './ItemCombobox'

const NEW_ITEM_UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'bottles', 'cans', 'bags', 'boxes', 'packs']

let nextKey = 1
/** One line of the form. `price` is what that line cost, typed in the expense's currency. */
export function newItemLine(inventoryId = '', quantity = '', price = '') {
  nextKey += 1
  return {
    key: nextKey,
    inventory_id: inventoryId,
    quantity: quantity === '' ? '' : String(quantity),
    price: price === '' || price == null ? '' : String(price),
    isNew: false,
    new_name: '',
    unit: 'kg',
  }
}

function isEmptyLine(line) {
  return line.inventory_id === '' && !line.isNew && String(line.quantity).trim() === '' && String(line.price).trim() === ''
}

/** Lines the user started (an item, a quantity or a price); fully empty lines are ignored. */
export function filledItemLines(lines) {
  return lines.filter((line) => !isEmptyLine(line))
}

function hasPrice(line) {
  return String(line.price).trim() !== ''
}

/**
 * The sum of the line prices, once any price is typed: then every line needs one and the
 * expense amount is that total. `entered` is false while no price is typed (amount is typed by hand).
 */
export function itemsPriceTotal(lines) {
  const filled = filledItemLines(lines)
  const entered = filled.some(hasPrice)
  const total = filled.reduce((sum, line) => sum + (Number(line.price) || 0), 0)
  return { entered, total }
}

export function itemLinesValid(lines) {
  const filled = filledItemLines(lines)
  const priced = filled.some(hasPrice)
  return filled.every((line) => (
    (line.isNew ? line.new_name.trim() !== '' && line.unit !== '' : line.inventory_id !== '')
    && Number(line.quantity) > 0
    && (!priced || (hasPrice(line) && Number(line.price) >= 0))
  ))
}

/**
 * What the API expects for each line: an existing item by id, or a new ingredient by name.
 * `toUsd` turns a typed price into dollars (the API stores dollars).
 */
export function itemLinesForApi(lines, toUsd) {
  return filledItemLines(lines).map((line) => {
    const cost = hasPrice(line) ? toUsd(Number(line.price)) : null
    return line.isNew
      ? { new_name: line.new_name.trim(), unit: line.unit, quantity: Number(line.quantity), cost }
      : { inventory_id: Number(line.inventory_id), quantity: Number(line.quantity), cost }
  })
}

function formatQuantity(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })
}

// No spin buttons: they would sit on top of the unit / currency label.
const numberInputClass = 'input-field w-full rounded-xl py-2 pl-3 pr-14 text-sm tabular-nums '
  + '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

function Suffix({ children }) {
  return (
    <span className="text-muted pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs">{children}</span>
  )
}

/**
 * The "Items bought" part of the expense form: one card per ingredient or stock item, with the
 * quantity bought (in that item's unit) and what it cost. Saving the expense adds them to stock.
 * A line can also be a new ingredient, created when the expense is saved.
 */
export default function ExpenseItemsField({ lines, onChange, error, labelId, currency = 'usd' }) {
  const { t } = useTranslation()
  const [stockItems, setStockItems] = useState(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch('/expenses/stock-items')
      .then(async (response) => {
        const data = await response.json().catch(() => [])
        if (cancelled) return
        if (!response.ok) throw new Error(data.message)
        setStockItems(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setLoadError(t('expenses.form.itemsLoadError'))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const byId = new Map((stockItems || []).map((item) => [item.id, item]))

  const money = (value) => (currency === 'khr' ? formatKhr(Math.round(value)) : formatUsd(value))
  const setLine = (key, changes) => onChange(lines.map((line) => (line.key === key ? { ...line, ...changes } : line)))
  const removeLine = (key) => {
    const rest = lines.filter((line) => line.key !== key)
    onChange(rest.length ? rest : [newItemLine()])
  }
  const { entered, total } = itemsPriceTotal(lines)

  return (
    <div className="rounded-2xl border border-forest-200 bg-forest-50/40 p-3 dark:border-forest-900/60 dark:bg-forest-950/20">
      <FieldLabel icon={Package} htmlFor={undefined}>
        <span id={labelId}>{t('expenses.form.items')}</span>
        <span className="text-red-600" aria-hidden>*</span>
      </FieldLabel>
      <p className="text-muted -mt-1 mb-2 text-xs">{t('expenses.form.itemsHint')}</p>

      {stockItems == null && !loadError ? (
        <p className="text-muted flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('common.loading')}
        </p>
      ) : null}
      {loadError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p> : null}

      {stockItems ? (
        <ul className="space-y-2" aria-labelledby={labelId}>
          {lines.map((line, index) => {
            const item = line.isNew ? null : byId.get(Number(line.inventory_id))
            const name = line.isNew ? line.new_name || t('expenses.form.newIngredient') : item?.name || t('expenses.form.chooseItem')
            const unit = line.isNew ? line.unit : item?.unit
            const unitPrice = Number(line.price) > 0 && Number(line.quantity) > 0 ? Number(line.price) / Number(line.quantity) : null
            return (
              <li key={line.key} className="rounded-xl border border-stone-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-900/40">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <ItemCombobox
                          id={`expense-item-${line.key}`}
                          items={stockItems}
                          selectedName={line.isNew ? line.new_name : item?.name || ''}
                          label={`${t('expenses.form.item')} ${index + 1}`}
                          invalid={Boolean(error) && !isEmptyLine(line) && !line.isNew && line.inventory_id === ''}
                          onPick={(picked) => setLine(line.key, { isNew: false, inventory_id: picked.id })}
                          onNew={(newName) => setLine(line.key, { isNew: true, inventory_id: '', new_name: newName.slice(0, 100) })}
                        />
                      </div>
                      {line.isNew ? (
                        <select
                          value={line.unit}
                          onChange={(event) => setLine(line.key, { unit: event.target.value })}
                          aria-label={`${t('expenses.form.unit')} ${index + 1}`}
                          className="input-field w-24 rounded-xl px-2 py-2 text-sm"
                        >
                          {NEW_ITEM_UNITS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : null}
                    </div>
                    {line.isNew ? (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-forest-700 dark:text-forest-300">
                        <Sparkles className="h-3 w-3" aria-hidden /> {t('expenses.form.newIngredientNote')}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    aria-label={t('expenses.form.removeItem', { name })}
                    className="mt-1 rounded-lg p-1.5 text-stone-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 pr-9">
                  <div className="relative">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                      aria-label={`${t('expenses.form.quantity')} ${index + 1}`}
                      aria-invalid={error && !isEmptyLine(line) && !(Number(line.quantity) > 0) ? true : undefined}
                      className={numberInputClass}
                      placeholder={t('expenses.form.quantity')}
                    />
                    {unit ? <Suffix>{unit}</Suffix> : null}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      inputMode={currency === 'khr' ? 'numeric' : 'decimal'}
                      min="0"
                      step={currency === 'khr' ? '100' : '0.01'}
                      value={line.price}
                      onChange={(event) => setLine(line.key, { price: event.target.value })}
                      aria-label={`${t('expenses.form.price')} ${index + 1}`}
                      aria-invalid={error && entered && !hasPrice(line) ? true : undefined}
                      className={numberInputClass}
                      placeholder={t('expenses.form.price')}
                    />
                    <Suffix>{currency === 'khr' ? '៛' : '$'}</Suffix>
                  </div>
                </div>

                <p className="text-muted mt-1 flex flex-wrap gap-x-3 text-[11px]">
                  {item ? <span>{t('expenses.form.onHand', { amount: `${formatQuantity(item.stock)} ${item.unit}`.trim() })}</span> : null}
                  {unitPrice != null ? (
                    <span>{t('expenses.form.unitPrice', { price: money(unitPrice), unit: unit || t('expenses.form.unit') })}</span>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      ) : null}

      {stockItems ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange([...lines, newItemLine()])}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-forest-700 transition hover:bg-forest-100 dark:text-forest-300 dark:hover:bg-forest-900/40"
          >
            <Plus className="h-4 w-4" aria-hidden /> {t('expenses.form.addItem')}
          </button>
          {entered ? (
            <span className="text-sm font-semibold tabular-nums">
              {t('expenses.form.itemsTotal', { amount: money(total) })}
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  )
}
