import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Check,
  CircleOff,
  ClipboardList,
  Hash,
  ListChecks,
  ListFilter,
  Package,
  PackageCheck,
  PackagePlus,
  Plus,
  Search,
  Settings2,
  Tag,
  TrendingDown,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../services/apiClient'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import FieldLabel from '../components/ui/FieldLabel'
import IconSelect from '../components/ui/IconSelect'
import ModalHeader from '../components/ui/ModalHeader'
import PaginationBar from '../components/ui/PaginationBar'
import Tooltip from '../components/ui/Tooltip'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import { localizeDigits } from '../utils/dateTimeFormat'
import { menuNameMatchesQuery, translateMenuName } from '../utils/menuNameTranslations'

const PAGE_SIZE = 10
const DEFAULT_LOW_THRESHOLD = 5
const UNIT_SUGGESTIONS = [
  { key: 'menuStock.unitPortions', value: 'portions' },
  { key: 'menuStock.unitCups', value: 'cups' },
  { key: 'menuStock.unitBottles', value: 'bottles' },
  { key: 'menuStock.unitCans', value: 'cans' },
]

const STATUS_TONES = {
  IN_STOCK: {
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50',
    dot: 'bg-emerald-500',
    key: 'menuStock.inStock',
  },
  LOW_STOCK: {
    pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50',
    dot: 'bg-amber-500',
    key: 'menuStock.lowStock',
  },
  OUT_OF_STOCK: {
    pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50',
    dot: 'bg-rose-500',
    key: 'menuStock.outOfStock',
  },
}

const NEUTRAL_PILL =
  'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700'

const ACTION_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-forest-50 hover:text-forest-600 focus-visible:outline-2 focus-visible:outline-forest-500 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300'

function Pill({ tone, dot, children }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold leading-none ring-1 ${tone}`}>
      {dot ? <span className={`block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden /> : null}
      {children}
    </span>
  )
}

function parseWhole(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  return Number(text)
}

function messageForError(t, data, fallbackKey) {
  if (data?.code === 'no_pack_size') return t('menuStock.errors.noPackSize')
  if (data?.code === 'not_tracked') return t('menuStock.errors.notTracked')
  return data?.message || t(fallbackKey)
}

async function sendJson(path, method, body) {
  const res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

function Backdrop({ children, panelRef, titleId, maxWidth = 'max-w-md' }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`modal-panel relative z-10 w-full ${maxWidth}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-panel-body p-6">{children}</div>
      </div>
    </div>
  )
}

function ModalActions({ onClose, submitLabel, disabled }) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2 text-xs font-semibold">
        {t('common.cancel')}
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="btn-primary beam-border flex-1 py-2 text-xs font-semibold shadow-[0_4px_14px_rgba(16,185,129,0.35)] disabled:pointer-events-none disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  )
}

function ModeButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tab-pill flex-1 rounded-xl px-3 py-2 text-xs ${active ? 'tab-pill-active' : 'tab-pill-inactive'}`}
    >
      {children}
    </button>
  )
}

function RestockModal({ item, displayName, onClose, onSaved }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const [mode, setMode] = useState('set')
  const [quantity, setQuantity] = useState(mode === 'set' ? String(item.stock_quantity ?? 0) : '')
  const [packs, setPacks] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const hasPack = Number(item.pack_size) >= 2
  const unit = item.unit_label || ''

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setPacks('')
    setQuantity(next === 'set' ? String(item.stock_quantity ?? 0) : '')
  }

  const quantityValue = quantity === '' ? 0 : parseWhole(quantity)
  const packsValue = packs === '' ? 0 : parseWhole(packs)
  const packUnits = hasPack && mode === 'add' && packsValue ? packsValue * Number(item.pack_size) : 0
  const addTotal = (quantityValue ?? 0) + packUnits
  const valid =
    mode === 'set'
      ? quantity !== '' && quantityValue !== null
      : quantityValue !== null && packsValue !== null && addTotal > 0

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError('')
    try {
      const body = mode === 'set' ? { mode: 'set', quantity: quantityValue } : { mode: 'add' }
      if (mode === 'add') {
        if (quantityValue) body.quantity = quantityValue
        if (hasPack && packsValue) body.packs = packsValue
      }
      const { ok, data } = await sendJson(`/inventory/menu-stock/${item.menu_item_id}/restock`, 'POST', body)
      if (!ok) {
        setError(messageForError(t, data, 'menuStock.errors.save'))
        return
      }
      onSaved(data.item, t('menuStock.restocked'))
    } catch (err) {
      setError(err.message || t('menuStock.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop panelRef={panelRef} titleId="menu-stock-restock-title">
      <ModalHeader
        icon={PackagePlus}
        title={t('menuStock.restockTitle')}
        subtitle={t('menuStock.restockSubtitle', { name: displayName })}
        titleId="menu-stock-restock-title"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-3 py-2.5 dark:border-obsidian-800">
          <span className="text-muted text-xs">{t('menuStock.currentAmount')}</span>
          <span className="text-heading text-sm font-bold tabular-nums">
            {localizeDigits(item.stock_quantity ?? 0)} {unit}
          </span>
        </div>

        <div className="flex gap-2">
          <ModeButton active={mode === 'set'} onClick={() => switchMode('set')}>
            {t('menuStock.modeSet')}
          </ModeButton>
          <ModeButton active={mode === 'add'} onClick={() => switchMode('add')}>
            {t('menuStock.modeAdd')}
          </ModeButton>
        </div>

        <div>
          <FieldLabel icon={Hash} htmlFor="menu-stock-quantity">
            {mode === 'set' ? t('menuStock.quantityNew') : t('menuStock.quantityAdd')}
          </FieldLabel>
          <div className="relative flex items-center">
            <input
              id="menu-stock-quantity"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              autoFocus
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="input-field w-full px-3 py-2 text-sm"
            />
            {unit ? <span className="text-muted pointer-events-none absolute right-10 text-xs">{unit}</span> : null}
          </div>
        </div>

        {hasPack && mode === 'add' ? (
          <div>
            <FieldLabel icon={Boxes} htmlFor="menu-stock-packs">
              {t('menuStock.packs')}
            </FieldLabel>
            <input
              id="menu-stock-packs"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={packs}
              onChange={(event) => setPacks(event.target.value)}
              className="input-field w-full px-3 py-2 text-sm"
            />
            <p className="text-muted mt-1.5 text-2xs leading-snug tabular-nums">
              {t('menuStock.packOf', { size: localizeDigits(item.pack_size) })}
              {packUnits > 0
                ? ` · ${t('menuStock.packsPreview', { count: localizeDigits(packUnits), unit })}`
                : ''}
            </p>
          </div>
        ) : null}

        {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

        <ModalActions
          onClose={onClose}
          disabled={!valid || saving}
          submitLabel={saving ? t('menuStock.saving') : t('menuStock.saveStock')}
        />
      </form>
    </Backdrop>
  )
}

function UnitField({ id, value, onChange }) {
  const { t } = useTranslation()
  return (
    <div>
      <FieldLabel icon={Tag} htmlFor={id}>
        {t('menuStock.unitLabel')}
      </FieldLabel>
      <input
        id={id}
        type="text"
        maxLength={30}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field w-full px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {UNIT_SUGGESTIONS.map((suggestion) => {
          const label = t(suggestion.key)
          const active = value.trim() === label || value.trim() === suggestion.value
          return (
            <button
              key={suggestion.value}
              type="button"
              onClick={() => onChange(label)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 transition ${
                active
                  ? 'bg-forest-50 text-forest-700 ring-forest-300 dark:bg-forest-950/50 dark:text-forest-300 dark:ring-forest-700'
                  : `${NEUTRAL_PILL} hover:bg-forest-50 hover:text-forest-700 dark:hover:bg-forest-950/40 dark:hover:text-forest-300`
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <p className="text-muted mt-1.5 text-2xs leading-snug">{t('menuStock.unitHint')}</p>
    </div>
  )
}

function PackAndThresholdFields({ idPrefix, packSize, onPackSize, threshold, onThreshold }) {
  const { t } = useTranslation()
  return (
    <>
      <div>
        <FieldLabel icon={Boxes} htmlFor={`${idPrefix}-pack`}>
          {t('menuStock.packSize')}
        </FieldLabel>
        <input
          id={`${idPrefix}-pack`}
          type="number"
          min="2"
          step="1"
          inputMode="numeric"
          value={packSize}
          onChange={(event) => onPackSize(event.target.value)}
          className="input-field w-full px-3 py-2 text-sm"
        />
        <p className="text-muted mt-1.5 text-2xs leading-snug">{t('menuStock.packSizeHint')}</p>
      </div>
      <div>
        <FieldLabel icon={TrendingDown} htmlFor={`${idPrefix}-threshold`}>
          {t('menuStock.lowThreshold')}
        </FieldLabel>
        <input
          id={`${idPrefix}-threshold`}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={threshold}
          onChange={(event) => onThreshold(event.target.value)}
          className="input-field w-full px-3 py-2 text-sm"
        />
        <p className="text-muted mt-1.5 text-2xs leading-snug">{t('menuStock.lowThresholdHint')}</p>
      </div>
    </>
  )
}

function validatePackAndThreshold(t, packSize, threshold) {
  const pack = packSize.trim() === '' ? null : parseWhole(packSize)
  if (packSize.trim() !== '' && (pack === null || pack < 2)) return { error: t('menuStock.errors.invalidPack') }
  const low = parseWhole(threshold)
  if (low === null) return { error: t('menuStock.errors.invalidThreshold') }
  return { pack, low }
}

function TrackModal({ item, displayName, onClose, onSaved }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [packSize, setPackSize] = useState('')
  const [threshold, setThreshold] = useState(String(DEFAULT_LOW_THRESHOLD))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    setError('')
    const start = parseWhole(quantity)
    if (start === null) {
      setError(t('menuStock.errors.invalidQuantity'))
      return
    }
    const checked = validatePackAndThreshold(t, packSize, threshold)
    if (checked.error) {
      setError(checked.error)
      return
    }
    const body = { quantity: start, low_threshold: checked.low }
    if (unit.trim()) body.unit_label = unit.trim()
    if (checked.pack) body.pack_size = checked.pack
    setSaving(true)
    try {
      const { ok, data } = await sendJson(`/inventory/menu-stock/${item.menu_item_id}/track`, 'POST', body)
      if (!ok) {
        setError(messageForError(t, data, 'menuStock.errors.save'))
        return
      }
      onSaved(data.item, t('menuStock.tracking'))
    } catch (err) {
      setError(err.message || t('menuStock.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop panelRef={panelRef} titleId="menu-stock-track-title">
      <ModalHeader
        icon={ListChecks}
        title={t('menuStock.trackTitle')}
        subtitle={t('menuStock.trackSubtitle', { name: displayName })}
        titleId="menu-stock-track-title"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto px-0.5">
        <div>
          <FieldLabel icon={Hash} htmlFor="menu-stock-track-quantity">
            {t('menuStock.trackStartQuantity')}
          </FieldLabel>
          <input
            id="menu-stock-track-quantity"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            autoFocus
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="input-field w-full px-3 py-2 text-sm"
          />
        </div>
        <UnitField id="menu-stock-track-unit" value={unit} onChange={setUnit} />
        <PackAndThresholdFields
          idPrefix="menu-stock-track"
          packSize={packSize}
          onPackSize={setPackSize}
          threshold={threshold}
          onThreshold={setThreshold}
        />
        {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        <ModalActions
          onClose={onClose}
          disabled={saving || quantity === ''}
          submitLabel={saving ? t('menuStock.saving') : t('menuStock.trackStock')}
        />
      </form>
    </Backdrop>
  )
}

function SettingsModal({ item, displayName, onClose, onSaved, onStopped }) {
  const { t } = useTranslation()
  const [confirmStop, setConfirmStop] = useState(false)
  const panelRef = useModalKeyboard({ isOpen: !confirmStop, onEscape: onClose, primaryActionMode: 'never' })
  const [unit, setUnit] = useState(item.unit_label || '')
  const [packSize, setPackSize] = useState(item.pack_size ? String(item.pack_size) : '')
  const [threshold, setThreshold] = useState(String(item.low_threshold ?? DEFAULT_LOW_THRESHOLD))
  const [saving, setSaving] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    setError('')
    const checked = validatePackAndThreshold(t, packSize, threshold)
    if (checked.error) {
      setError(checked.error)
      return
    }
    const body = { pack_size: checked.pack, low_threshold: checked.low }
    if (unit.trim()) body.unit_label = unit.trim()
    setSaving(true)
    try {
      const { ok, data } = await sendJson(`/inventory/menu-stock/${item.menu_item_id}/settings`, 'PATCH', body)
      if (!ok) {
        setError(messageForError(t, data, 'menuStock.errors.save'))
        return
      }
      onSaved(data.item, t('menuStock.settingsSaved'))
    } catch (err) {
      setError(err.message || t('menuStock.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const handleStop = async () => {
    if (stopping) return
    setStopping(true)
    try {
      const { ok, data } = await sendJson(`/inventory/menu-stock/${item.menu_item_id}/untrack`, 'POST')
      if (!ok) {
        setConfirmStop(false)
        setError(messageForError(t, data, 'menuStock.errors.untrack'))
        return
      }
      onStopped(item.menu_item_id, t('menuStock.stopped'))
    } catch (err) {
      setConfirmStop(false)
      setError(err.message || t('menuStock.errors.untrack'))
    } finally {
      setStopping(false)
    }
  }

  return (
    <>
      <Backdrop panelRef={panelRef} titleId="menu-stock-settings-title">
        <ModalHeader
          icon={Settings2}
          title={t('menuStock.settingsTitle')}
          subtitle={displayName}
          titleId="menu-stock-settings-title"
          onClose={onClose}
        />
        <form onSubmit={handleSubmit} className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto px-0.5">
          <UnitField id="menu-stock-settings-unit" value={unit} onChange={setUnit} />
          <PackAndThresholdFields
            idPrefix="menu-stock-settings"
            packSize={packSize}
            onPackSize={setPackSize}
            threshold={threshold}
            onThreshold={setThreshold}
          />
          {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
          <ModalActions
            onClose={onClose}
            disabled={saving}
            submitLabel={saving ? t('menuStock.saving') : t('common.saveChanges')}
          />
          <button
            type="button"
            onClick={() => setConfirmStop(true)}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 text-xs font-semibold text-red-600 transition hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-500 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
          >
            <CircleOff className="h-4 w-4" aria-hidden />
            {t('menuStock.stopTracking')}
          </button>
        </form>
      </Backdrop>
      <ConfirmDeleteModal
        isOpen={confirmStop}
        title={t('menuStock.stopTrackingTitle')}
        itemName={displayName}
        message={t('menuStock.stopTrackingMessage')}
        confirmLabel={t('menuStock.stopTracking')}
        onCancel={() => !stopping && setConfirmStop(false)}
        onConfirm={handleStop}
      />
    </>
  )
}

export default function MenuStock() {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const toastTimerRef = useRef(null)

  const showToast = useCallback((message) => {
    setToast(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  const loadStock = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/inventory/menu-stock')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || t('menuStock.loadFailed'))
      setItems(Array.isArray(data.items) ? data.items : [])
      setSummary(data.summary || null)
    } catch (err) {
      setError(err.message || t('menuStock.loadFailed'))
      setItems([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadStock()
  }, [loadStock])

  const counts = useMemo(() => {
    const base = summary || {}
    const tracked = items.filter((item) => item.tracked)
    return {
      total: base.total ?? items.length,
      tracked: base.tracked ?? tracked.length,
      low: base.low ?? tracked.filter((item) => item.stock_status === 'LOW_STOCK').length,
      out: base.out ?? tracked.filter((item) => item.stock_status === 'OUT_OF_STOCK').length,
    }
  }, [items, summary])

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (filter === 'tracked' && !item.tracked) return false
        if (filter === 'untracked' && item.tracked) return false
        if (filter === 'low' && item.stock_status !== 'LOW_STOCK') return false
        if (filter === 'out' && item.stock_status !== 'OUT_OF_STOCK') return false
        return !search.trim() || menuNameMatchesQuery(item.name, search, i18n.language, t)
      }),
    [items, filter, search, i18n.language, t],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const recount = (list) => {
    const tracked = list.filter((item) => item.tracked)
    setSummary({
      total: list.length,
      tracked: tracked.length,
      untracked: list.length - tracked.length,
      low: tracked.filter((item) => item.stock_status === 'LOW_STOCK').length,
      out: tracked.filter((item) => item.stock_status === 'OUT_OF_STOCK').length,
    })
  }

  const applyItem = (updated, message) => {
    const next = items.map((item) =>
      item.menu_item_id === updated.menu_item_id ? { ...item, ...updated } : item,
    )
    setItems(next)
    recount(next)
    setModal(null)
    showToast(message)
  }

  const applyUntracked = (menuItemId, message) => {
    const next = items.map((item) =>
      item.menu_item_id === menuItemId
        ? {
            ...item,
            tracked: false,
            inventory_id: null,
            stock_quantity: null,
            pack_size: null,
            stock_status: null,
          }
        : item,
    )
    setItems(next)
    recount(next)
    setModal(null)
    showToast(message)
  }

  const filterOptions = [
    { value: 'all', label: t('menuStock.filterAll'), icon: ListFilter },
    { value: 'tracked', label: t('menuStock.filterTracked'), icon: PackageCheck },
    { value: 'untracked', label: t('menuStock.filterUntracked'), icon: CircleOff },
    { value: 'low', label: t('menuStock.filterLow'), icon: TrendingDown },
    { value: 'out', label: t('menuStock.filterOut'), icon: AlertTriangle },
  ]

  const summaryChips = [
    { key: 'total', label: t('menuStock.summaryTotal'), value: counts.total, tone: NEUTRAL_PILL },
    { key: 'tracked', label: t('menuStock.summaryTracked'), value: counts.tracked, tone: STATUS_TONES.IN_STOCK.pill },
    { key: 'low', label: t('menuStock.summaryLow'), value: counts.low, tone: STATUS_TONES.LOW_STOCK.pill },
    { key: 'out', label: t('menuStock.summaryOut'), value: counts.out, tone: STATUS_TONES.OUT_OF_STOCK.pill },
  ]

  const nameOf = (item) => translateMenuName(item.name, i18n.language, t)

  return (
    <>
      {toast ? (
        <div
          role="status"
          className="fixed top-5 right-5 z-[80] flex items-center gap-2 rounded-xl bg-forest-800 px-4 py-3 text-sm font-medium text-white shadow-xl animate-in fade-in slide-in-from-top-3"
        >
          <Check className="h-4 w-4 text-emerald-400" aria-hidden />
          <span>{toast}</span>
        </div>
      ) : null}
      <div className="page-enter space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
            <div className="min-w-0">
              <h3 className="page-title">{t('nav.inventoryStock')}</h3>
              <p className="text-muted text-xs">{t('menuStock.subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {summaryChips.map((chip) => (
              <span
                key={chip.key}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold leading-none ring-1 ${chip.tone}`}
              >
                {chip.label}
                <span className="tabular-nums">{localizeDigits(chip.value)}</span>
              </span>
            ))}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="table-shell overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-500 dark:text-zinc-400"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
                placeholder={t('menuStock.searchPlaceholder')}
                aria-label={t('menuStock.searchPlaceholder')}
                className="input-field rounded-xl pl-11 shadow-sm"
              />
            </div>
            <div className="sm:w-60">
              <IconSelect
                value={filter}
                onChange={(value) => {
                  setFilter(value)
                  setPage(0)
                }}
                options={filterOptions}
                className="rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto lg:min-h-[53rem]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="table-head text-xs uppercase tracking-wider">
                  <th className="px-6 py-3.5">{t('menuStock.colName')}</th>
                  <th className="px-6 py-3.5">{t('menuStock.colSale')}</th>
                  <th className="px-6 py-3.5">{t('menuStock.colStock')}</th>
                  <th className="px-6 py-3.5">{t('menuStock.colStatus')}</th>
                  <th className="px-6 py-3.5 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="table-divider">
                {loading && items.length === 0
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`skeleton-${index}`} aria-hidden>
                        {Array.from({ length: 5 }).map((__, cell) => (
                          <td key={cell} className="px-6 py-4">
                            <div className="h-5 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-zinc-800" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
                {!loading && pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-14 text-center">
                      <ClipboardList className="mx-auto mb-2 h-6 w-6 text-slate-400 dark:text-zinc-500" aria-hidden />
                      <p className="text-muted text-sm">{t('menuStock.empty')}</p>
                    </td>
                  </tr>
                ) : null}
                {pageItems.map((item) => {
                  const onSale = item.is_available !== false
                  const tone = item.tracked ? STATUS_TONES[item.stock_status] : null
                  return (
                    <tr key={item.menu_item_id} className="table-row hover:bg-stone-50/50 dark:hover:bg-obsidian-900/20">
                      <td className="px-6 py-4">
                        <p className="text-heading text-sm font-semibold">{nameOf(item)}</p>
                        {item.category ? <span className="badge-olive mt-1 inline-block">{item.category}</span> : null}
                      </td>
                      <td className="px-6 py-4">
                        <Pill
                          tone={
                            onSale
                              ? STATUS_TONES.IN_STOCK.pill
                              : NEUTRAL_PILL
                          }
                          dot={onSale ? STATUS_TONES.IN_STOCK.dot : 'bg-slate-400'}
                        >
                          {onSale ? t('menuStock.onSale') : t('menuStock.offSale')}
                        </Pill>
                      </td>
                      <td className="px-6 py-4">
                        {item.tracked ? (
                          <p className="text-heading text-sm font-semibold tabular-nums">
                            {localizeDigits(item.stock_quantity ?? 0)}
                            <span className="text-muted ml-1 text-xs font-normal">{item.unit_label}</span>
                          </p>
                        ) : (
                          <Pill tone={NEUTRAL_PILL}>{t('menuStock.notTracked')}</Pill>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {tone ? (
                          <Pill tone={tone.pill} dot={tone.dot}>
                            {t(tone.key)}
                          </Pill>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="ml-auto flex w-fit items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
                          {item.tracked ? (
                            <>
                              <Tooltip label={t('menuStock.restock')} side="left">
                                <button
                                  type="button"
                                  onClick={() => setModal({ type: 'restock', item })}
                                  aria-label={t('menuStock.restock')}
                                  className={ACTION_BUTTON}
                                >
                                  <PackagePlus className="h-4 w-4" aria-hidden />
                                </button>
                              </Tooltip>
                              <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                              <Tooltip label={t('menuStock.settings')} side="left">
                                <button
                                  type="button"
                                  onClick={() => setModal({ type: 'settings', item })}
                                  aria-label={t('menuStock.settings')}
                                  className={ACTION_BUTTON}
                                >
                                  <Settings2 className="h-4 w-4" aria-hidden />
                                </button>
                              </Tooltip>
                            </>
                          ) : (
                            <Tooltip label={t('menuStock.trackStock')} side="left">
                              <button
                                type="button"
                                onClick={() => setModal({ type: 'track', item })}
                                aria-label={t('menuStock.trackStock')}
                                className={ACTION_BUTTON}
                              >
                                <Plus className="h-4 w-4" aria-hidden />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted shrink-0 text-xs tabular-nums">
              {filtered.length > 0
                ? t('menuStock.showingRange', {
                    from: localizeDigits(currentPage * PAGE_SIZE + 1),
                    to: localizeDigits(Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)),
                    total: localizeDigits(filtered.length),
                  })
                : ''}
            </p>
            <PaginationBar
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
              alwaysShow
              className="sm:min-w-[22rem]"
            />
          </div>
        </div>
      </div>

      {modal?.type === 'restock' ? (
        <RestockModal
          key={modal.item.menu_item_id}
          item={modal.item}
          displayName={nameOf(modal.item)}
          onClose={() => setModal(null)}
          onSaved={applyItem}
        />
      ) : null}
      {modal?.type === 'track' ? (
        <TrackModal
          key={modal.item.menu_item_id}
          item={modal.item}
          displayName={nameOf(modal.item)}
          onClose={() => setModal(null)}
          onSaved={applyItem}
        />
      ) : null}
      {modal?.type === 'settings' ? (
        <SettingsModal
          key={modal.item.menu_item_id}
          item={modal.item}
          displayName={nameOf(modal.item)}
          onClose={() => setModal(null)}
          onSaved={applyItem}
          onStopped={applyUntracked}
        />
      ) : null}
    </>
  )
}
