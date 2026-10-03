import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Link2, Package, PackagePlus, Scale, Search, Wallet, X } from 'lucide-react'
import Modal from '../components/common/Modal'
import StocktakeModal from '../components/inventory/StocktakeModal'
import ExpenseLogModal from '../components/finance/ExpenseLogModal'
import StatusBadge from '../components/common/StatusBadge'
import { useAuth } from '../context/AuthContext'
import { userHasPermission } from '../utils/permissions'
import { apiFetch } from '../services/apiClient'
import { cacheInventoryItems, getInventoryFallback } from '../utils/offlineFallbacks'
import { useModalKeyboard } from '../hooks/useModalKeyboard'

const statusStyles = {
  'In Stock':
    'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/30 ring-1 ring-emerald-500/30',
  'Low Stock':
    'bg-amber-500/10 text-amber-900 ring-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-500/30 ring-1',
  'Very Low Stock':
    'bg-red-500/10 text-red-900 ring-red-500/30 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-500/30 ring-1',
  'Out of Stock':
    'bg-red-500/10 text-red-900 ring-red-500/30 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-500/30 ring-1',
}

const barColors = {
  'In Stock': 'from-emerald-500 to-teal-500',
  'Low Stock': 'from-amber-400 to-amber-500',
  'Very Low Stock': 'from-red-500 to-red-600',
  'Out of Stock': 'from-red-400 to-red-500',
}

const STATUS_I18N_KEYS = {
  'In Stock': 'statuses.inStock',
  'Low Stock': 'statuses.lowStock',
  'Very Low Stock': 'statuses.veryLowStock',
  'Out of Stock': 'statuses.outOfStock',
}

function getStatus(item) {
  const stock = Number(item.stock_quantity)
  if (!Number.isFinite(stock) || stock <= 0) return 'Out of Stock'
  if (item.critical_threshold != null && stock <= Number(item.critical_threshold)) return 'Very Low Stock'
  if (stock <= Number(item.low_threshold)) return 'Low Stock'
  return 'In Stock'
}

const STATUS_SEVERITY = {
  'Out of Stock': 0,
  'Very Low Stock': 1,
  'Low Stock': 2,
  'In Stock': 3,
}

function compareStockUrgency(a, b) {
  const statusA = getStatus(a)
  const statusB = getStatus(b)
  const rankA = STATUS_SEVERITY[statusA] ?? 3
  const rankB = STATUS_SEVERITY[statusB] ?? 3

  if (rankA !== rankB) {
    return rankA - rankB
  }

  return (a.item_name || '').localeCompare(b.item_name || '')
}

function formatAmount(value, isWeight) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  const exact = Math.round(num * 1000) / 1000
  if (!isWeight && Number.isInteger(exact)) return exact
  return exact
}

function amountStep(value, isWeight) {
  if (isWeight) return 0.001
  return Number.isInteger(formatAmount(value, false)) ? 1 : 0.001
}

function formatStockDisplay(item) {
  const current = formatAmount(item.stock_quantity, item.is_weight)
  const max = formatAmount(item.max_stock, item.is_weight)
  return `${current} / ${max} ${item.unit_label}`
}

function getFillPercent(item) {
  const stock = Number(item.stock_quantity)
  const max = Number(item.max_stock)
  if (!Number.isFinite(stock) || stock <= 0 || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(100, (stock / max) * 100)
}

function StockGauge({ item }) {
  const status = getStatus(item)
  const fill = getFillPercent(item)

  return (
    <div className="min-w-0">
      <p className="whitespace-nowrap text-heading text-sm font-semibold tabular-nums">{formatStockDisplay(item)}</p>
      <div className="mt-2 h-2 w-full max-w-[9rem] overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${barColors[status]}`}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  )
}

function InventoryTable({ items, onRestock, onHistory, onAdjust, onEdit, onLink, canManageItems, canAdjustStock, isLoading }) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div className="space-y-2 px-6 py-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-10 animate-pulse rounded-lg bg-slate-200/70 dark:bg-zinc-700/50" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-muted text-sm">{t('inventory.noMatches')}</p>
      </div>
    )
  }

  return (
    <div>
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col />
          <col className="w-[22%]" />
          <col className="w-[12.5rem]" />
          <col className="w-[8.75rem]" />
        </colgroup>
        <thead>
          <tr className="table-head">
            <th className="px-4 py-3">{t('inventory.itemName')}</th>
            <th className="px-4 py-3">{t('common.category')}</th>
            <th className="px-4 py-3">{t('inventory.stockOnHand')}</th>
            <th className="whitespace-nowrap px-4 py-3">{t('common.status')}</th>
            <th className="px-4 py-3">{t('common.action')}</th>
          </tr>
        </thead>
        <tbody className="table-divider">
          {items.map((item) => {
            const status = getStatus(item)
            return (
              <tr key={item.id} className="table-row">
                <td className="text-heading break-words px-4 py-4 font-semibold">
                  <div>{item.item_name}</div>
                  {item.menu_links?.length ? (
                    <div className="relative mt-1 inline-block group">
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-800 transition-colors hover:bg-emerald-500/20 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50 cursor-pointer select-none"
                        title={item.menu_links.map((link) => link.menu_name).join(', ')}
                      >
                        <Link2 className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          {t('inventory.linkedRecipesCount', { count: item.menu_links.length })}
                        </span>
                      </span>

                      {/* Tooltip on hover */}
                      <div className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-stone-200/90 bg-white/95 p-3 shadow-xl backdrop-blur-md ring-1 ring-black/5 transition-all duration-150 ease-out opacity-0 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 dark:border-zinc-700/80 dark:bg-zinc-900/95">
                        <div className="mb-2 flex items-center justify-between border-b border-stone-200/60 pb-1.5 dark:border-zinc-800">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-700 dark:text-zinc-200">
                            <Link2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            {t('inventory.linkedRecipesTitle', { count: item.menu_links.length })}
                          </span>
                          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                            {item.menu_links.length}
                          </span>
                        </div>
                        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs font-normal">
                          {item.menu_links.map((link, idx) => (
                            <li
                              key={link.menu_id || idx}
                              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-stone-600 transition-colors hover:bg-stone-100/70 hover:text-stone-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-white"
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span className="truncate">{link.menu_name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </td>
                <td className="table-cell-muted break-words px-4 py-4">{item.category}</td>
                <td className="px-4 py-4">
                  <StockGauge item={item} />
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <StatusBadge className={`transition-colors duration-300 ${statusStyles[status]}`}>
                    {t(STATUS_I18N_KEYS[status])}
                  </StatusBadge>
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-col items-start gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRestock(item)}
                    className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
                  >
                    <PackagePlus className="h-3.5 w-3.5" />
                    {t('inventory.addStock')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onHistory(item)}
                    className="text-xs font-semibold text-forest-700 dark:text-forest-400"
                  >
                    {t('inventory.history')}
                  </button>
                  {canAdjustStock || canManageItems ? (
                    <>
                      {canManageItems ? (
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          className="text-xs font-semibold text-forest-700 dark:text-forest-400"
                        >
                          {t('inventory.editItem')}
                        </button>
                      ) : null}
                      {canAdjustStock ? (
                        <button
                          type="button"
                          onClick={() => onAdjust(item)}
                          className="text-xs font-semibold text-forest-700 dark:text-forest-400"
                        >
                          {t('inventory.adjustStock')}
                        </button>
                      ) : null}
                      {canManageItems ? (
                        <button
                          type="button"
                          onClick={() => onLink(item)}
                          className="text-xs font-semibold text-forest-700 dark:text-forest-400"
                        >
                          {t('inventory.linkRecipe')}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RestockModal({ item, onClose, onSave }) {
  const { t } = useTranslation()
  const [quantityToAdd, setQuantityToAdd] = useState('')
  const [error, setError] = useState('')
  const units = item.unit_label
  const step = amountStep(item.stock_quantity, item.is_weight)

  const panelRef = useModalKeyboard({
    isOpen: Boolean(item),
    onEscape: onClose,
    primaryActionMode: 'auto',
  })

  const currentStock = Number(item.stock_quantity)
  const added = Number(quantityToAdd)
  const previewStock = Number.isFinite(currentStock) && Number.isFinite(added) && added > 0
    ? currentStock + added
    : currentStock
  const previewItem = { ...item, stock_quantity: previewStock }

  const handleSubmit = (event) => {
    event.preventDefault()
    setError('')

    const quantity = Number(quantityToAdd)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError(t('inventory.invalidAmount'))
      return
    }

    onSave(item.id, quantity)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="modal-backdrop" onClick={onClose} />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="modal-panel relative z-10 w-full max-w-md p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-heading text-lg">{t('inventory.addStock')}</h3>
            <p className="text-muted mt-1 text-sm">
              {t('inventory.addStockFor', { item: item.item_name })}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-stone-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="surface-inset mt-5 space-y-3 px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-muted text-xs">{t('inventory.currentOnHand')}</p>
              <p className="text-heading text-lg font-bold tabular-nums">{formatStockDisplay(item)}</p>
            </div>
            <div className="text-right">
              <p className="text-muted text-xs">{t('inventory.afterUpdate')}</p>
              <p className="text-lg font-bold tabular-nums text-forest-600 dark:text-forest-400">{formatStockDisplay(previewItem)}</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="quantity-to-add" className="mb-1.5 block text-sm font-medium">
              {t('inventory.receivedQuantity', { units })}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="quantity-to-add"
                type="number"
                min={step}
                step={step}
                value={quantityToAdd}
                onChange={(e) => { setQuantityToAdd(e.target.value); setError('') }}
                placeholder={item.is_weight ? t('inventory.weightPlaceholder') : t('inventory.countPlaceholder')}
                className="input-field min-w-0 flex-1"
              />
              {String(item.item_name).trim().toLowerCase() === 'condensed milk' && (
                <button
                  type="button"
                  onClick={() => {
                    const current = Number(quantityToAdd)
                    const next = (Number.isFinite(current) && current > 0 ? current : 0) + 24
                    setQuantityToAdd(String(next))
                    setError('')
                  }}
                  className="btn-secondary shrink-0 whitespace-nowrap px-3 py-2.5 text-sm"
                >
                  {t('inventory.addOneBoxCans', { cans: 24 })}
                </button>
              )}
            </div>
            <p className="text-muted mt-1.5 text-xs">{t('inventory.addHint')}</p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
            <button type="submit" className="btn-primary flex-1 py-2.5 text-sm">{t('inventory.addStock')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function HistoryModal({ item, onClose }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch(`/inventory/${item.id}/movements`)
      .then(async (response) => {
        const data = await response.json().catch(() => [])
        if (!response.ok) throw new Error(data.message || 'Failed')
        if (!cancelled) setRows(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [item.id])

  return (
    <Modal
      title={t('inventory.historyFor', { item: item.item_name })}
      onClose={onClose}
      closeLabel={t('a11y.close')}
      maxWidth="max-w-lg"
    >
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {rows.length === 0 && !error ? (
        <p className="text-muted text-sm">{t('inventory.noHistory')}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const change = formatAmount(row.change_amount, item.is_weight)
            const signed = Number.isFinite(change) && change > 0 ? `+${change}` : String(change)
            return (
              <li key={row.id} className="border-b border-border/60 pb-3 text-sm last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold tabular-nums">{signed}</span>
                  <span className="text-muted text-xs">
                    {t(`inventory.movement.${row.reason}`, { defaultValue: row.reason })}
                  </span>
                </div>
                <p className="text-muted mt-0.5 text-xs">
                  {new Date(row.created_at).toLocaleString()}
                  {row.invoice_id ? ` · ${row.invoice_id}` : ''}
                  {row.display_name ? ` · ${row.display_name}` : ''}
                </p>
                {row.note ? <p className="mt-1 text-xs">{row.note}</p> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

function AdjustModal({ item, onClose, onSaved }) {
  const { t } = useTranslation()
  const [count, setCount] = useState(String(formatAmount(item.stock_quantity, item.is_weight)))
  const [reason, setReason] = useState('correction')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const step = amountStep(item.stock_quantity, item.is_weight)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (!note.trim()) {
      setError(t('inventory.noteRequired'))
      return
    }
    setSaving(true)
    try {
      const response = await apiFetch(`/inventory/${item.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_quantity: Number(count),
          reason,
          note: note.trim(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('inventory.invalidAmount'))
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('inventory.adjustStock')}
      onClose={onClose}
      closeLabel={t('a11y.close')}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="adjust-stock-form" disabled={saving} className="btn-primary flex-1 py-2.5 text-sm">
            {t('inventory.saveAdjustment')}
          </button>
        </>
      )}
    >
      <form id="adjust-stock-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-muted text-sm">{item.item_name}</p>
        <label className="block text-sm font-medium">
          {t('inventory.exactCount', { units: item.unit_label })}
          <input
            type="number"
            step={step}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className="input-field mt-1.5"
            required
          />
        </label>
        <label className="block text-sm font-medium">
          {t('inventory.reason')}
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="input-field mt-1.5"
          >
            <option value="waste">{t('inventory.reasonWaste')}</option>
            <option value="correction">{t('inventory.reasonCorrection')}</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t('inventory.note')}
          <input
            type="text"
            value={note}
            maxLength={255}
            onChange={(event) => setNote(event.target.value)}
            className="input-field mt-1.5"
            required
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </Modal>
  )
}

const STOCK_UNITS = [
  { id: 'kg', section: 'uncountable' },
  { id: 'bags', section: 'countable' },
  { id: 'bottles', section: 'countable' },
  { id: 'packs', section: 'countable' },
  { id: 'boxes', section: 'countable' },
  { id: 'eggs', section: 'countable' },
  { id: 'coconuts', section: 'countable' },
  { id: 'cans', section: 'countable' },
  { id: 'tea bags', section: 'countable' },
]

function unitsFor(section) {
  return STOCK_UNITS.filter((unit) => unit.section === section)
}

function defaultThresholds(max) {
  const num = Number(max)
  if (!Number.isFinite(num) || num < 0) return { low: '', critical: '' }
  return {
    low: String(Math.round(num * 0.2 * 1000) / 1000),
    critical: String(Math.round(num * 0.1 * 1000) / 1000),
  }
}

function SearchField({ label, placeholder, query, onQuery, options, onSelect, emptyAction }) {
  const [open, setOpen] = useState(false)
  const shown = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div>
      <label className="block text-sm font-medium">
        {label}
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            onQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className="input-field mt-1.5 w-full"
          autoComplete="off"
        />
      </label>
      {open ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-border bg-card">
          {shown.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-olive-50 dark:hover:bg-olive-900/30"
                onClick={() => {
                  onSelect(option)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-3 py-2">{emptyAction}</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

function ItemFormModal({ mode, item, prefillName, stacked, onClose, onSaved, onUseExisting }) {
  const { t } = useTranslation()
  const editing = mode === 'edit'
  const [name, setName] = useState(editing ? item.item_name : (prefillName || ''))
  const [category, setCategory] = useState(editing ? item.category : '')
  const [section, setSection] = useState(editing ? item.section : 'uncountable')
  const [unit, setUnit] = useState(editing ? item.unit_label : 'kg')
  const [stock, setStock] = useState(editing ? '' : '0')
  const [max, setMax] = useState(editing ? String(item.max_stock) : '')
  const [low, setLow] = useState(editing ? String(item.low_threshold ?? '') : '')
  const [critical, setCritical] = useState(editing && item.critical_threshold != null ? String(item.critical_threshold) : '')
  const [thresholdsTouched, setThresholdsTouched] = useState(editing)
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState(null)
  const [duplicate, setDuplicate] = useState(null)
  const [confirmUnit, setConfirmUnit] = useState(false)
  const [saving, setSaving] = useState(false)

  const changeSection = (next) => {
    setSection(next)
    const allowed = unitsFor(next)
    if (!allowed.some((entry) => entry.id === unit)) setUnit(allowed[0].id)
  }

  const changeMax = (value) => {
    setMax(value)
    if (!thresholdsTouched) {
      const next = defaultThresholds(value)
      setLow(next.low)
      setCritical(next.critical)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuggestion(null)
    setDuplicate(null)
    if (!name.trim()) {
      setError(t('inventory.nameRequired'))
      return
    }
    if (!category.trim()) {
      setError(t('inventory.categoryRequired'))
      return
    }
    const numbers = editing ? [max, low] : [stock, max, low, critical]
    if (!editing && critical === '') {
      setError(t('inventory.numberMin'))
      return
    }
    if (numbers.some((value) => value === '' || Number(value) < 0 || !Number.isFinite(Number(value)))) {
      setError(t('inventory.numberMin'))
      return
    }
    if (critical !== '' && (Number(critical) < 0 || !Number.isFinite(Number(critical)))) {
      setError(t('inventory.numberMin'))
      return
    }
    if (Number(max) < Number(low) || (critical !== '' && Number(max) < Number(critical))) {
      setError(t('inventory.maxBelowThreshold'))
      return
    }

    const payload = {
      item_name: name,
      category,
      section,
      unit_label: unit,
      max_stock: Number(max),
      low_threshold: Number(low),
      critical_threshold: critical === '' ? null : Number(critical),
    }
    if (!editing) payload.stock_quantity = Number(stock)
    if (confirmUnit) payload.confirm_unit_change = true

    setSaving(true)
    try {
      const response = await apiFetch(editing ? `/inventory/${item.id}` : '/inventory', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.code === 'similar') {
        setSuggestion(data.suggestions?.[0] || null)
        return
      }
      if (response.status === 409 && data.code === 'duplicate') {
        setDuplicate(data.item)
        return
      }
      if (response.status === 409 && data.code === 'unit_change') {
        setConfirmUnit(true)
        setError(t('inventory.unitChangeWarning'))
        return
      }
      if (!response.ok) throw new Error(data.message || t('inventory.invalidAmount'))
      onSaved(data.item)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const existing = suggestion || duplicate

  return (
    <Modal
      title={editing ? t('inventory.editItemFor', { item: item.item_name }) : t('inventory.addItem')}
      titleId="stock-item-form-title"
      onClose={onClose}
      closeLabel={t('a11y.close')}
      stacked={stacked}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary min-w-[8rem] flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="stock-item-form" disabled={saving} className="btn-primary min-w-[8rem] flex-1 py-2.5 text-sm">
            {confirmUnit ? t('inventory.changeUnit') : t('inventory.saveItem')}
          </button>
        </>
      )}
    >
      <form id="stock-item-form" onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm font-medium">
          {t('inventory.itemName')}
          <input value={name} onChange={(event) => setName(event.target.value)} className="input-field mt-1.5 w-full" required />
        </label>
        <label className="block text-sm font-medium">
          {t('common.category')}
          <input value={category} onChange={(event) => setCategory(event.target.value)} className="input-field mt-1.5 w-full" required />
        </label>
        <label className="block text-sm font-medium">
          {t('inventory.tableType')}
          <select value={section} onChange={(event) => changeSection(event.target.value)} className="input-field mt-1.5 w-full">
            <option value="uncountable">{t('inventory.kitchenKg')}</option>
            <option value="countable">{t('inventory.barUnit')}</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t('inventory.unit')}
          <select value={unit} onChange={(event) => setUnit(event.target.value)} className="input-field mt-1.5 w-full">
            {unitsFor(section).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.id}</option>
            ))}
          </select>
        </label>
        {editing ? null : (
          <label className="block text-sm font-medium">
            {t('inventory.currentCount')}
            <input type="number" min="0" step={section === 'uncountable' ? '0.001' : '1'} value={stock} onChange={(event) => setStock(event.target.value)} className="input-field mt-1.5 w-full" required />
          </label>
        )}
        <label className="block text-sm font-medium">
          {t('inventory.maximum')}
          <input type="number" min="0" step={section === 'uncountable' ? '0.001' : '1'} value={max} onChange={(event) => changeMax(event.target.value)} className="input-field mt-1.5 w-full" required />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t('inventory.lowThreshold')}
            <input type="number" min="0" step="0.001" value={low} onChange={(event) => { setThresholdsTouched(true); setLow(event.target.value) }} className="input-field mt-1.5 w-full" required />
          </label>
          <label className="block text-sm font-medium">
            {t('inventory.veryLowThreshold')}
            <input type="number" min="0" step="0.001" value={critical} onChange={(event) => { setThresholdsTouched(true); setCritical(event.target.value) }} className="input-field mt-1.5 w-full" required={!editing} />
          </label>
        </div>
        {existing ? (
          <div className="space-y-2">
            <p className="text-sm">
              {suggestion ? t('inventory.didYouMean', { name: suggestion.item_name }) : t('inventory.alreadyInStock', { name: duplicate.item_name })}
            </p>
            <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={() => onUseExisting(existing)}>
              {t('inventory.useExisting')}
            </button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </Modal>
  )
}

function LinkModal({ item, stockItems, pickedStock, onRequestCreate, onClose, onSaved, dismissible = true }) {
  const { t } = useTranslation()
  const [menuItems, setMenuItems] = useState([])
  const [menuQuery, setMenuQuery] = useState('')
  const [menuItemId, setMenuItemId] = useState('')
  const [stockQuery, setStockQuery] = useState(item?.item_name || '')
  const [stockId, setStockId] = useState(item?.id || '')
  const [perSale, setPerSale] = useState('1')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!pickedStock) return
    setStockId(pickedStock.id)
    setStockQuery(pickedStock.item_name)
  }, [pickedStock])

  useEffect(() => {
    let cancelled = false
    apiFetch('/menu')
      .then(async (response) => {
        const data = await response.json().catch(() => [])
        if (!cancelled && Array.isArray(data)) setMenuItems(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!menuItemId || !stockId) {
      setError(t('inventory.chooseIngredient'))
      return
    }
    setError('')
    setSaving(true)
    try {
      const response = await apiFetch(`/inventory/${stockId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_item_id: Number(menuItemId),
          quantity_per_unit: Number(perSale),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('inventory.invalidAmount'))
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const removeLink = async (linkId) => {
    setError('')
    const response = await apiFetch(`/inventory/links/${linkId}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message || t('inventory.invalidAmount'))
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Modal
      title={t('inventory.linkRecipe')}
      titleId="stock-link-title"
      onClose={onClose}
      closeLabel={t('a11y.close')}
      dismissible={dismissible}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="stock-link-form" disabled={saving} className="btn-primary flex-1 py-2.5 text-sm">
            {t('inventory.saveLink')}
          </button>
        </>
      )}
    >
      <form id="stock-link-form" onSubmit={handleSubmit} className="space-y-4">
        {(stockItems.find((row) => row.id === stockId) || item)?.menu_links?.length ? (
          <ul className="space-y-2">
            {(stockItems.find((row) => row.id === stockId) || item).menu_links.map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">{link.menu_name} · {link.quantity_per_unit}</span>
                <button type="button" onClick={() => removeLink(link.id)} className="shrink-0 text-xs font-semibold text-red-600">
                  {t('inventory.removeLink')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">{t('inventory.notLinked')}</p>
        )}
        <SearchField
          label={t('inventory.chooseMenuItem')}
          placeholder={t('inventory.chooseMenuItem')}
          query={menuQuery}
          onQuery={setMenuQuery}
          options={menuItems.map((menuItem) => ({ id: menuItem.id, label: menuItem.name }))}
          onSelect={(option) => {
            setMenuItemId(option.id)
            setMenuQuery(option.label)
          }}
        />
        <SearchField
          label={t('inventory.chooseIngredient')}
          placeholder={t('inventory.searchIngredients')}
          query={stockQuery}
          onQuery={(value) => {
            setStockQuery(value)
            const selected = stockItems.find((row) => row.id === stockId)
            if (!selected || selected.item_name.toLowerCase() !== value.trim().toLowerCase()) setStockId('')
          }}
          options={stockItems.map((row) => ({ id: row.id, label: row.item_name }))}
          onSelect={(option) => {
            setStockId(option.id)
            setStockQuery(option.label)
          }}
          emptyAction={stockQuery.trim() ? (
            <button type="button" className="text-sm font-semibold text-forest-700 dark:text-forest-400" onClick={() => onRequestCreate(stockQuery.trim())}>
              {t('inventory.addNamedToStock', { name: stockQuery.trim() })}
            </button>
          ) : (
            <span className="text-muted text-sm">{t('inventory.noMatches')}</span>
          )}
        />
        <label className="block text-sm font-medium">
          {t('inventory.perSale')}
          <input
            type="number"
            min="0.01"
            step="0.001"
            value={perSale}
            onChange={(event) => setPerSale(event.target.value)}
            className="input-field mt-1.5"
            required
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </Modal>
  )
}

const INVENTORY_CATEGORY_KEYS = {
  All: 'all',
  'Bar Supplies': 'barSupplies',
  Coffee: 'coffee',
  Tea: 'tea',
  'Cold Drinks': 'coldDrinks',
  Drinks: 'drinks',
  Beer: 'beer',
  Dairy: 'dairy',
  Packaging: 'packaging',
  Meat: 'meat',
  Fish: 'fish',
  Produce: 'produce',
  Pantry: 'pantry',
  'Bakery Prep': 'bakeryPrep',
  Sauces: 'sauces',
  Liquids: 'liquids',
  Oils: 'oils',
}

function inventoryCategoryLabel(category, t) {
  const key = INVENTORY_CATEGORY_KEYS[category]
  if (key) {
    return t(`inventory.categories.${key}`, { defaultValue: category })
  }
  return category
}

export default function InventoryStock() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const canManageItems = userHasPermission(user, 'inventory_stock')
  const canAdjustStock = canManageItems
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [usingFallbackInventory, setUsingFallbackInventory] = useState(false)
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [restockItem, setRestockItem] = useState(null)
  const [historyItem, setHistoryItem] = useState(null)
  const [adjustItem, setAdjustItem] = useState(null)
  const [linkItem, setLinkItem] = useState(null)
  const [linkPick, setLinkPick] = useState(null)
  const [itemForm, setItemForm] = useState(null)
  const [stocktakeOpen, setStocktakeOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)

  const fetchInventory = useCallback(async () => {
    try {
      const response = await apiFetch('/inventory')
      if (!response.ok) {
        throw new Error(`Server status returned ${response.status}`)
      }
      const data = await response.json()
      const nextItems = Array.isArray(data) ? data : data.items || []
      if (nextItems.length === 0) {
        setItems(getInventoryFallback())
        setUsingFallbackInventory(true)
        return
      }
      cacheInventoryItems(nextItems)
      setItems(nextItems)
      setUsingFallbackInventory(false)
    } catch (error) {
      console.error('Error loading inventory layout:', error)
      setItems(getInventoryFallback())
      setUsingFallbackInventory(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInventory()
  }, [fetchInventory])

  const handleSaveRestock = async (id, newStock) => {
    try {
      const response = await apiFetch(`/inventory/${id}/stock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity_received: newStock })
      })
      if (response.ok) fetchInventory()
    } catch (error) {
      console.error("Error submitting stock update:", error)
    }
  }

  const categories = useMemo(() => {
    const found = new Set()
    items.forEach((item) => {
      const cat = String(item.category || '').trim()
      if (cat) found.add(cat)
    })
    const priority = [
      'Coffee',
      'Tea',
      'Cold Drinks',
      'Drinks',
      'Beer',
      'Bar Supplies',
      'Dairy',
      'Packaging',
      'Meat',
      'Fish',
      'Produce',
      'Bakery Prep',
      'Pantry',
      'Sauces',
      'Oils',
      'Liquids',
    ]
    const sorted = Array.from(found).sort((a, b) => {
      const indexA = priority.indexOf(a)
      const indexB = priority.indexOf(b)
      if (indexA !== -1 && indexB !== -1) return indexA - indexB
      if (indexA !== -1) return -1
      if (indexB !== -1) return 1
      return a.localeCompare(b)
    })
    return ['All', ...sorted]
  }, [items])

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        const matchesCategory =
          activeCategory === 'All' ||
          String(item.category || '').toLowerCase() === activeCategory.toLowerCase()
        const query = search.trim().toLowerCase()
        const matchesSearch =
          !query ||
          String(item.item_name || '').toLowerCase().includes(query) ||
          String(item.category || '').toLowerCase().includes(query)
        return matchesCategory && matchesSearch
      })
      .sort(compareStockUrgency)
  }, [items, activeCategory, search])

  const countableItems = filteredItems.filter((item) => item.section === 'countable')
  const uncountableItems = filteredItems.filter((item) => item.section === 'uncountable')

  return (
    <div className="space-y-6 pt-2">
      {usingFallbackInventory && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t('inventory.offlineData')}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-heading text-lg leading-normal">{t('nav.inventoryStock')}</h3>
          {canManageItems ? (
            <>
              <button type="button" onClick={() => setItemForm({ mode: 'create' })} className="btn-primary px-3 py-2 text-xs font-semibold">
                {t('inventory.addItem')}
              </button>
              <button type="button" onClick={() => setStocktakeOpen(true)} className="btn-secondary px-3 py-2 text-xs font-semibold">
                <ClipboardList className="mr-1.5 inline h-3.5 w-3.5" />
                {t('inventory.stocktake')}
              </button>
              <button type="button" onClick={() => setExpenseOpen(true)} className="btn-secondary px-3 py-2 text-xs font-semibold">
                <Wallet className="mr-1.5 inline h-3.5 w-3.5" />
                {t('inventory.expense')}
              </button>
            </>
          ) : null}
        </div>
        <div className="relative max-w-xs flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder={t('inventory.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-10"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`tab-pill ${
              activeCategory === category ? 'tab-pill-active' : 'tab-pill-inactive'
            }`}
          >
            {inventoryCategoryLabel(category, t)}
          </button>
        ))}
      </div>

      {activeCategory !== 'All' && countableItems.length === 0 && uncountableItems.length === 0 ? (
        <div className="table-shell px-6 py-12 text-center">
          <p className="text-muted text-sm">{t('inventory.noMatches')}</p>
        </div>
      ) : (
        <>
          {(activeCategory === 'All' || countableItems.length > 0) && (
            <section className="table-shell !overflow-visible">
              <div className="flex items-start gap-3 border-b px-6 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-olive-100 dark:bg-olive-900/40">
                  <Package className="h-5 w-5 text-forest-600 dark:text-forest-400" />
                </div>
                <div>
                  <h4 className="text-heading text-base font-semibold">{t('inventory.countableTitle')}</h4>
                  <p className="text-muted mt-0.5 text-sm">{t('inventory.countableDescription')}</p>
                </div>
              </div>
              <InventoryTable
                items={countableItems}
                onRestock={setRestockItem}
                onHistory={setHistoryItem}
                onAdjust={setAdjustItem}
                onEdit={(row) => setItemForm({ mode: 'edit', item: row })}
                onLink={setLinkItem}
                canManageItems={canManageItems}
                canAdjustStock={canAdjustStock}
                isLoading={isLoading}
              />
            </section>
          )}

          {(activeCategory === 'All' || uncountableItems.length > 0) && (
            <section className="table-shell !overflow-visible">
              <div className="flex items-start gap-3 border-b px-6 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-olive-100 dark:bg-olive-900/40">
                  <Scale className="h-5 w-5 text-forest-600 dark:text-forest-400" />
                </div>
                <div>
                  <h4 className="text-heading text-base font-semibold">{t('inventory.uncountableTitle')}</h4>
                  <p className="text-muted mt-0.5 text-sm">{t('inventory.uncountableDescription')}</p>
                </div>
              </div>
              <InventoryTable
                items={uncountableItems}
                onRestock={setRestockItem}
                onHistory={setHistoryItem}
                onAdjust={setAdjustItem}
                onEdit={(row) => setItemForm({ mode: 'edit', item: row })}
                onLink={setLinkItem}
                canManageItems={canManageItems}
                canAdjustStock={canAdjustStock}
                isLoading={isLoading}
              />
            </section>
          )}
        </>
      )}

      {stocktakeOpen && canManageItems ? (
        <StocktakeModal
          items={items}
          onClose={() => setStocktakeOpen(false)}
          onApplied={fetchInventory}
        />
      ) : null}
      {expenseOpen && canManageItems ? (
        <ExpenseLogModal onClose={() => setExpenseOpen(false)} />
      ) : null}
      {restockItem && (
        <RestockModal
          item={restockItem}
          onClose={() => setRestockItem(null)}
          onSave={handleSaveRestock}
        />
      )}
      {historyItem && (
        <HistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
      )}
      {adjustItem && (
        <AdjustModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onSaved={fetchInventory}
        />
      )}
      {linkItem && (
        <LinkModal
          item={linkItem}
          stockItems={items}
          pickedStock={linkPick}
          dismissible={!itemForm}
          onRequestCreate={(name) => setItemForm({ mode: 'create', prefillName: name, fromLink: true })}
          onClose={() => {
            setLinkItem(null)
            setLinkPick(null)
          }}
          onSaved={fetchInventory}
        />
      )}
      {itemForm && (
        <ItemFormModal
          mode={itemForm.mode}
          item={itemForm.item}
          prefillName={itemForm.prefillName}
          stacked={Boolean(linkItem)}
          onClose={() => setItemForm(null)}
          onSaved={(saved) => {
            fetchInventory()
            if (itemForm.fromLink && saved) setLinkPick(saved)
            setItemForm(null)
          }}
          onUseExisting={(existing) => {
            if (itemForm.fromLink) setLinkPick(existing)
            else setSearch(existing.item_name)
            setItemForm(null)
          }}
        />
      )}
    </div>
  )
}
