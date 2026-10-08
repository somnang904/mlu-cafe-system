import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CircleX,
  ArrowLeftRight,
  Carrot,
  Check,
  ClipboardList,
  Hash,
  History,
  Package,
  ListFilter,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Tag,
  Trash2,
  TrendingDown,
  Scale,
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

const PAGE_SIZE = 10
const DEFAULT_LOW_THRESHOLD = 5

const BASE_UNIT_SUGGESTIONS = [
  { key: 'ingredients.unitG', value: 'g' },
  { key: 'ingredients.unitMl', value: 'ml' },
  { key: 'ingredients.unitPcs', value: 'pcs' },
]

const PURCHASE_UNIT_SUGGESTIONS = [
  { key: 'ingredients.purchaseBag', value: 'bag' },
  { key: 'ingredients.purchaseBox', value: 'box' },
  { key: 'ingredients.purchaseBottle', value: 'bottle' },
  { key: 'ingredients.purchaseCarton', value: 'carton' },
  { key: 'ingredients.purchaseTray', value: 'tray' },
  { key: 'ingredients.purchasePack', value: 'pack' },
]

const STATUS_TONES = {
  IN_STOCK: {
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50',
    dot: 'bg-emerald-500',
    key: 'ingredients.inStock',
  },
  LOW_STOCK: {
    pill: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50',
    dot: 'bg-amber-500',
    key: 'ingredients.lowStock',
  },
  OUT_OF_STOCK: {
    pill: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50',
    dot: 'bg-rose-500',
    key: 'ingredients.outOfStock',
  },
}

const NEUTRAL_PILL =
  'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700'

const ACTION_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-forest-50 hover:text-forest-600 focus-visible:outline-2 focus-visible:outline-forest-500 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300'

const DANGER_ACTION_BUTTON =
  'flex h-8 w-8 items-center justify-center rounded-full text-red-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300'

const ADD_BUTTON =
  'btn-primary beam-border inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold shadow-[0_4px_14px_rgba(16,185,129,0.35)]'

function Pill({ tone, dot, children }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold leading-none ring-1 ${tone}`}>
      {dot ? <span className={`block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden /> : null}
      {children}
    </span>
  )
}

function parseAmount(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null
  return Number(text)
}

function formatAmount(value, digits = 3) {
  return localizeDigits(Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits }))
}

function purchaseSizeOf(item) {
  const size = Number(item?.purchase_size)
  return item?.purchase_unit && size > 0 ? size : 0
}

function messageForError(t, data, fallbackKey) {
  if (data?.code === 'no_purchase_size') return t('ingredients.errors.noPurchaseSize')
  if (data?.code === 'duplicate_name') return t('ingredients.errors.duplicateName')
  if (data?.code === 'invalid_reason') return t('ingredients.errors.invalidReason')
  if (data?.code === 'exceeds_stock') return t('ingredients.errors.exceedsStock')
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

function ChipField({ id, icon, label, hint, value, onChange, suggestions, maxLength = 60, autoFocus = false }) {
  const { t } = useTranslation()
  return (
    <div>
      <FieldLabel icon={icon} htmlFor={id}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type="text"
        maxLength={maxLength}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field w-full px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((suggestion) => {
          const text = t(suggestion.key)
          const current = value.trim().toLowerCase()
          const active = current === text.toLowerCase() || current === suggestion.value.toLowerCase()
          return (
            <button
              key={suggestion.value}
              type="button"
              onClick={() => onChange(suggestion.value)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-2xs font-semibold ring-1 transition ${
                active
                  ? 'bg-forest-50 text-forest-700 ring-forest-300 dark:bg-forest-950/50 dark:text-forest-300 dark:ring-forest-700'
                  : `${NEUTRAL_PILL} hover:bg-forest-50 hover:text-forest-700 dark:hover:bg-forest-950/40 dark:hover:text-forest-300`
              }`}
            >
              {text}
            </button>
          )
        })}
      </div>
      {hint ? <p className="text-muted mt-1.5 text-2xs leading-snug">{hint}</p> : null}
    </div>
  )
}

function NumberField({ id, icon, label, hint, value, onChange, step = '1', autoFocus = false, suffix }) {
  return (
    <div>
      <FieldLabel icon={icon} htmlFor={id}>
        {label}
      </FieldLabel>
      <div className="relative flex items-center">
        <input
          id={id}
          type="number"
          min="0"
          step={step}
          inputMode="decimal"
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input-field w-full px-3 py-2 text-sm"
        />
        {suffix ? <span className="text-muted pointer-events-none absolute right-10 text-xs">{suffix}</span> : null}
      </div>
      {hint ? <p className="text-muted mt-1.5 text-2xs leading-snug">{hint}</p> : null}
    </div>
  )
}

function IngredientFormModal({ item, onClose, onSaved }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const isEdit = Boolean(item)
  const [name, setName] = useState(item?.item_name || '')
  const category = item?.category || ''
  const [unit, setUnit] = useState(item?.unit_label || '')
  const [purchaseUnit, setPurchaseUnit] = useState(item?.purchase_unit || '')
  const [purchaseSize, setPurchaseSize] = useState(item?.purchase_size ? String(Number(item.purchase_size)) : '')
  const [quantity, setQuantity] = useState('')
  const [threshold, setThreshold] = useState(String(item ? item.low_threshold ?? DEFAULT_LOW_THRESHOLD : DEFAULT_LOW_THRESHOLD))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    setError('')
    if (!name.trim()) {
      setError(t('ingredients.errors.invalidName'))
      return
    }
    if (!unit.trim()) {
      setError(t('ingredients.errors.invalidUnit'))
      return
    }
    const low = parseAmount(threshold)
    if (low === null) {
      setError(t('ingredients.errors.invalidThreshold'))
      return
    }
    const purchase = purchaseUnit.trim()
    const size = purchase ? parseAmount(purchaseSize) : null
    if (purchase && !(size > 0)) {
      setError(t('ingredients.errors.invalidPurchaseSize'))
      return
    }
    const body = {
      name: name.trim(),
      category: category.trim() || 'Other',
      unit_label: unit.trim(),
      low_threshold: low,
      purchase_unit: purchase || null,
      purchase_size: purchase ? size : null,
    }
    if (!isEdit) {
      const start = quantity.trim() === '' ? 0 : parseAmount(quantity)
      if (start === null) {
        setError(t('ingredients.errors.invalidQuantity'))
        return
      }
      body.quantity = start
    }
    setSaving(true)
    try {
      const { ok, data } = isEdit
        ? await sendJson(`/ingredients/${item.id}`, 'PATCH', body)
        : await sendJson('/ingredients', 'POST', body)
      if (!ok) {
        setError(messageForError(t, data, 'ingredients.errors.save'))
        return
      }
      onSaved(data.item, isEdit ? t('ingredients.updated') : t('ingredients.added'), !isEdit)
    } catch (err) {
      setError(err.message || t('ingredients.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop panelRef={panelRef} titleId="ingredients-form-title">
      <ModalHeader
        icon={Carrot}
        title={isEdit ? t('ingredients.editTitle') : t('ingredients.addTitle')}
        subtitle={isEdit ? item.item_name : t('ingredients.addSubtitle')}
        titleId="ingredients-form-title"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto px-0.5">
        <div>
          <FieldLabel icon={Carrot} htmlFor="ingredients-form-name">
            {t('ingredients.nameLabel')}
          </FieldLabel>
          <input
            id="ingredients-form-name"
            type="text"
            maxLength={100}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="input-field w-full px-3 py-2 text-sm"
          />
        </div>
        <ChipField
          id="ingredients-form-unit"
          icon={Tag}
          label={t('ingredients.baseUnitLabel')}
          hint={t('ingredients.baseUnitHint')}
          value={unit}
          onChange={setUnit}
          suggestions={BASE_UNIT_SUGGESTIONS}
          maxLength={30}
        />
        <ChipField
          id="ingredients-form-purchase-unit"
          icon={Package}
          label={t('ingredients.purchaseUnitLabel')}
          hint={t('ingredients.purchaseUnitHint')}
          value={purchaseUnit}
          onChange={setPurchaseUnit}
          suggestions={PURCHASE_UNIT_SUGGESTIONS}
          maxLength={30}
        />
        {purchaseUnit.trim() ? (
          <NumberField
            id="ingredients-form-purchase-size"
            icon={Hash}
            label={t('ingredients.purchaseSizeLabel', {
              unit: unit.trim() || t('ingredients.baseUnitFallback'),
              purchase: purchaseUnit.trim(),
            })}
            step="any"
            value={purchaseSize}
            onChange={setPurchaseSize}
            suffix={unit.trim()}
          />
        ) : null}
        {isEdit ? null : (
          <NumberField
            id="ingredients-form-quantity"
            icon={Hash}
            label={t('ingredients.startAmount')}
            step="any"
            value={quantity}
            onChange={setQuantity}
          />
        )}
        <NumberField
          id="ingredients-form-threshold"
          icon={TrendingDown}
          label={t('ingredients.lowThreshold')}
          hint={t('ingredients.lowThresholdHint')}
          step="any"
          value={threshold}
          onChange={setThreshold}
        />
        {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        <ModalActions
          onClose={onClose}
          disabled={saving}
          submitLabel={saving ? t('ingredients.saving') : isEdit ? t('common.saveChanges') : t('common.save')}
        />
      </form>
    </Backdrop>
  )
}

function AdjustModal({ item, onClose, onSaved }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const onHand = Number(item.stock_quantity ?? 0)
  const unit = item.unit_label || ''
  const [mode, setMode] = useState('add')
  const purchaseSize = purchaseSizeOf(item)
  const [quantity, setQuantity] = useState('')
  const [packs, setPacks] = useState('')
  const [reason, setReason] = useState('used')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setQuantity(next === 'count' ? String(onHand) : '')
    setPacks('')
  }

  const amount = parseAmount(quantity)
  const usePacks = mode === 'add' && purchaseSize > 0
  const packsValue = usePacks && packs.trim() !== '' ? parseAmount(packs) : 0
  const looseValue = usePacks && quantity.trim() === '' ? 0 : amount
  const addTotal = (looseValue || 0) + (packsValue || 0) * purchaseSize
  const exceeds = mode === 'remove' && amount !== null && amount > onHand
  const valid =
    mode === 'count'
      ? amount !== null
      : usePacks
        ? looseValue !== null && packsValue !== null && addTotal > 0
        : amount !== null && amount > 0 && !exceeds

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError('')
    try {
      const body = { mode }
      if (usePacks) {
        if (looseValue > 0) body.quantity = looseValue
        if (packsValue > 0) body.packs = packsValue
      } else {
        body.quantity = amount
      }
      if (mode === 'remove') body.reason = reason
      if (note.trim()) body.note = note.trim()
      const { ok, data } = await sendJson(`/ingredients/${item.id}/adjust`, 'POST', body)
      if (!ok) {
        setError(messageForError(t, data, 'ingredients.errors.save'))
        return
      }
      onSaved(data.item, t('ingredients.adjusted'), false)
    } catch (err) {
      setError(err.message || t('ingredients.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const quantityLabel =
    mode === 'remove'
      ? t('ingredients.quantityRemove')
      : mode === 'count'
        ? t('ingredients.quantityCount')
        : t('ingredients.quantityAdd')

  return (
    <Backdrop panelRef={panelRef} titleId="ingredients-adjust-title">
      <ModalHeader
        icon={Scale}
        title={t('ingredients.adjustTitle')}
        subtitle={item.item_name}
        titleId="ingredients-adjust-title"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto px-0.5">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-3 py-2.5 dark:border-obsidian-800">
          <span className="text-muted text-xs">{t('ingredients.currentAmount')}</span>
          <span className="text-heading text-sm font-bold tabular-nums">
            {localizeDigits(onHand)} {unit}
          </span>
        </div>

        <div className="flex gap-2">
          <ModeButton active={mode === 'add'} onClick={() => switchMode('add')}>
            {t('ingredients.modeAdd')}
          </ModeButton>
          <ModeButton active={mode === 'remove'} onClick={() => switchMode('remove')}>
            {t('ingredients.modeRemove')}
          </ModeButton>
          <ModeButton active={mode === 'count'} onClick={() => switchMode('count')}>
            {t('ingredients.modeCount')}
          </ModeButton>
        </div>

        <NumberField
          id="ingredients-adjust-quantity"
          icon={Hash}
          label={quantityLabel}
          hint={mode === 'count' ? t('ingredients.countHint') : undefined}
          step="any"
          autoFocus
          value={quantity}
          onChange={setQuantity}
          suffix={unit}
        />

        {usePacks ? (
          <div>
            <NumberField
              id="ingredients-adjust-packs"
              icon={Package}
              label={t('ingredients.packsLabel', { purchase: item.purchase_unit })}
              step="any"
              value={packs}
              onChange={setPacks}
              suffix={item.purchase_unit}
            />
            <p className="text-muted mt-1.5 text-2xs leading-snug tabular-nums">
              {t('ingredients.packOf', { purchase: item.purchase_unit, size: formatAmount(purchaseSize), unit })}
              {addTotal > 0 ? ` · ${t('ingredients.packsPreview', { count: formatAmount(addTotal), unit })}` : ''}
            </p>
          </div>
        ) : null}

        {mode === 'remove' ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              {t('ingredients.removeReason')}
            </p>
            <div className="flex flex-wrap gap-2">
              <ModeButton active={reason === 'used'} onClick={() => setReason('used')}>
                {t('ingredients.reasonUsed')}
              </ModeButton>
              <ModeButton active={reason === 'waste'} onClick={() => setReason('waste')}>
                {t('ingredients.reasonWaste')}
              </ModeButton>
              <ModeButton active={reason === 'mistake'} onClick={() => setReason('mistake')}>
                {t('ingredients.reasonMistake')}
              </ModeButton>
            </div>
            {exceeds ? (
              <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {t('ingredients.removeExceeds', { count: localizeDigits(onHand), unit })}
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <FieldLabel icon={StickyNote} htmlFor="ingredients-adjust-note">
            {t('ingredients.noteLabel')}
          </FieldLabel>
          <input
            id="ingredients-adjust-note"
            type="text"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('ingredients.notePlaceholder')}
            className="input-field w-full px-3 py-2 text-sm"
          />
        </div>

        {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

        <ModalActions
          onClose={onClose}
          disabled={!valid || saving}
          submitLabel={saving ? t('ingredients.saving') : t('ingredients.saveAmount')}
        />
      </form>
    </Backdrop>
  )
}

function ConvertModal({ item, onClose, onSaved }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const onHand = Number(item.stock_quantity ?? 0)
  const oldUnit = item.unit_label || ''
  const [newUnit, setNewUnit] = useState('')
  const [factor, setFactor] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const factorValue = parseAmount(factor)
  const target = newUnit.trim()
  const valid = Boolean(target) && factorValue !== null && factorValue > 0
  const newAmount = valid ? Math.round(onHand * factorValue * 1000) / 1000 : null

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError('')
    try {
      const { ok, data } = await sendJson(`/ingredients/${item.id}/convert`, 'POST', { unit_label: target, factor: factorValue })
      if (!ok) {
        setError(messageForError(t, data, 'ingredients.errors.save'))
        return
      }
      onSaved(data.item, t('ingredients.converted'), false)
    } catch (err) {
      setError(err.message || t('ingredients.errors.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Backdrop panelRef={panelRef} titleId="ingredients-convert-title">
      <ModalHeader
        icon={ArrowLeftRight}
        title={t('ingredients.convertTitle')}
        subtitle={item.item_name}
        titleId="ingredients-convert-title"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto px-0.5">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-3 py-2.5 dark:border-obsidian-800">
          <span className="text-muted text-xs">{t('ingredients.currentAmount')}</span>
          <span className="text-heading text-sm font-bold tabular-nums">
            {formatAmount(onHand)} {oldUnit}
          </span>
        </div>
        <ChipField
          id="ingredients-convert-unit"
          icon={Tag}
          label={t('ingredients.convertNewUnit')}
          value={newUnit}
          onChange={setNewUnit}
          suggestions={BASE_UNIT_SUGGESTIONS}
          maxLength={30}
          autoFocus
        />
        <NumberField
          id="ingredients-convert-factor"
          icon={Hash}
          label={t('ingredients.convertFactor', { old: oldUnit, unit: target || t('ingredients.baseUnitFallback') })}
          step="any"
          value={factor}
          onChange={setFactor}
          suffix={target}
        />
        {newAmount !== null ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-forest-200 bg-forest-50/60 px-3 py-2.5 dark:border-forest-900/60 dark:bg-forest-950/30">
            <span className="text-muted text-xs">{t('ingredients.convertPreview')}</span>
            <span className="text-heading text-sm font-bold tabular-nums">
              {formatAmount(newAmount)} {target}
            </span>
          </div>
        ) : null}
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-snug text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('ingredients.convertWarning')}
        </p>
        {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        <ModalActions
          onClose={onClose}
          disabled={!valid || saving}
          submitLabel={saving ? t('ingredients.saving') : t('ingredients.convertSave')}
        />
      </form>
    </Backdrop>
  )
}

const MOVEMENT_REASON_KEYS = {
  sale: 'ingredients.moveSale',
  restock: 'ingredients.moveRestock',
  cancel: 'ingredients.moveCancel',
  adjustment: 'ingredients.moveAdjustment',
  waste: 'ingredients.moveWaste',
}

function HistoryModal({ item, onClose }) {
  const { t, i18n } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const unit = item.unit_label || ''

  useEffect(() => {
    let cancelled = false
    apiFetch(`/inventory/${item.id}/movements`)
      .then(async (response) => {
        const data = await response.json().catch(() => [])
        if (!response.ok) throw new Error(data.message || t('ingredients.errors.history'))
        if (!cancelled) setRows(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || t('ingredients.errors.history'))
      })
    return () => {
      cancelled = true
    }
  }, [item.id, t])

  const formatWhen = (value) =>
    new Date(value).toLocaleString(i18n.language === 'km' ? 'km-KH' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Backdrop panelRef={panelRef} titleId="ingredients-history-title">
      <ModalHeader
        icon={History}
        title={t('ingredients.historyTitle')}
        subtitle={item.item_name}
        titleId="ingredients-history-title"
        onClose={onClose}
      />
      <div className="mt-5 max-h-[22rem] overflow-y-auto">
        {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        {!error && rows === null ? <p className="text-muted text-sm">{t('ingredients.loading')}</p> : null}
        {rows && rows.length === 0 ? <p className="text-muted text-sm">{t('ingredients.historyEmpty')}</p> : null}
        {rows && rows.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {rows.map((row) => {
              const change = Number(row.change_amount)
              const label = t(MOVEMENT_REASON_KEYS[row.reason] || 'ingredients.moveAdjustment')
              return (
                <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-heading text-sm font-medium">{label}</p>
                    <p className="text-muted text-2xs tabular-nums">
                      {formatWhen(row.created_at)}
                      {row.display_name ? ` · ${row.display_name}` : ''}
                    </p>
                    {row.note ? <p className="text-muted mt-0.5 break-words text-2xs">{row.note}</p> : null}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p
                      className={`text-sm font-bold ${
                        change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {change > 0 ? '+' : ''}
                      {localizeDigits(change)}
                    </p>
                    <p className="text-muted text-2xs">
                      {localizeDigits(Number(row.quantity_after))} {unit}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
      <div className="mt-4">
        <button type="button" onClick={onClose} className="btn-secondary w-full py-2 text-xs font-semibold">
          {t('common.close')}
        </button>
      </div>
    </Backdrop>
  )
}

export default function Ingredients() {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimerRef = useRef(null)

  const showToast = useCallback((message) => {
    setToast(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(''), 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/ingredients')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || t('ingredients.loadFailed'))
      setItems(Array.isArray(data.items) ? data.items : [])
      setSummary(data.summary || null)
    } catch (err) {
      setError(err.message || t('ingredients.loadFailed'))
      setItems([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const recount = (list) => {
    setSummary({
      total: list.length,
      low: list.filter((item) => item.stock_status === 'LOW_STOCK').length,
      out: list.filter((item) => item.stock_status === 'OUT_OF_STOCK').length,
    })
  }

  const counts = useMemo(() => {
    const base = summary || {}
    return {
      total: base.total ?? items.length,
      low: base.low ?? items.filter((item) => item.stock_status === 'LOW_STOCK').length,
      out: base.out ?? items.filter((item) => item.stock_status === 'OUT_OF_STOCK').length,
    }
  }, [items, summary])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (filter === 'low' && item.stock_status !== 'LOW_STOCK') return false
      if (filter === 'out' && item.stock_status !== 'OUT_OF_STOCK') return false
      if (!query) return true
      return (
        String(item.item_name || '').toLowerCase().includes(query) ||
        String(item.category || '').toLowerCase().includes(query)
      )
    })
  }, [items, filter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)

  const applyItem = (saved, message, isNew) => {
    const next = isNew
      ? [...items, saved].sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)))
      : items.map((item) => (item.id === saved.id ? { ...item, ...saved } : item))
    setItems(next)
    recount(next)
    setModal(null)
    showToast(message)
  }

  const handleRemove = async () => {
    if (removing || modal?.type !== 'remove') return
    const target = modal.item
    setRemoving(true)
    try {
      const { ok, data } = await sendJson(`/ingredients/${target.id}`, 'DELETE')
      if (!ok) {
        setModal(null)
        setError(messageForError(t, data, 'ingredients.errors.remove'))
        return
      }
      const next = items.filter((item) => item.id !== target.id)
      setItems(next)
      recount(next)
      setError('')
      setModal(null)
      showToast(t('ingredients.removed'))
    } catch (err) {
      setModal(null)
      setError(err.message || t('ingredients.errors.remove'))
    } finally {
      setRemoving(false)
    }
  }

  const filterOptions = [
    { value: 'all', label: t('ingredients.filterAll'), icon: ListFilter },
    { value: 'low', label: t('ingredients.filterLow'), icon: TrendingDown },
    { value: 'out', label: t('ingredients.filterOut'), icon: AlertTriangle },
  ]

  const summaryCards = [
    {
      key: 'total',
      label: t('ingredients.summaryTotal'),
      value: counts.total,
      icon: Package,
      iconTone: 'text-forest-600 dark:text-forest-400',
    },
    {
      key: 'low',
      label: t('ingredients.summaryLow'),
      value: counts.low,
      icon: AlertTriangle,
      iconTone: 'text-amber-500 dark:text-amber-400',
    },
    {
      key: 'out',
      label: t('ingredients.summaryOut'),
      value: counts.out,
      icon: CircleX,
      iconTone: 'text-rose-500 dark:text-rose-400',
    },
  ]

  const openAdd = () => setModal({ type: 'form', item: null })
  const listIsEmpty = !loading && items.length === 0 && !error

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
            <Carrot className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
            <div className="min-w-0">
              <h3 className="page-title">{t('nav.ingredients')}</h3>
              <p className="text-muted text-xs">{t('ingredients.subtitle')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {summaryCards.map((card) => {
              const Icon = card.icon
              return (
                <div key={card.key} className="surface-card flex items-center gap-4 p-4">
                  <span className={`flex shrink-0 items-center justify-center ${card.iconTone}`}>
                    <Icon className="h-10 w-10" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-muted truncate text-xs font-semibold uppercase tracking-wide">{card.label}</p>
                    <p className="text-heading mt-0.5 text-2xl font-bold tabular-nums">{localizeDigits(card.value)}</p>
                  </div>
                </div>
              )
            })}
          </div>
          <button type="button" onClick={openAdd} className={ADD_BUTTON}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('ingredients.addIngredient')}
          </button>
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
                placeholder={t('ingredients.searchPlaceholder')}
                aria-label={t('ingredients.searchPlaceholder')}
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
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="table-head text-xs uppercase tracking-wider">
                  <th className="px-6 py-3.5">{t('ingredients.colName')}</th>
                  <th className="px-6 py-3.5">{t('ingredients.colAmount')}</th>
                  <th className="px-6 py-3.5">{t('ingredients.colStatus')}</th>
                  <th className="px-6 py-3.5 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="table-divider">
                {loading && items.length === 0
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={`skeleton-${index}`} aria-hidden>
                        {Array.from({ length: 4 }).map((__, cell) => (
                          <td key={cell} className="px-6 py-4">
                            <div className="h-5 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-zinc-800" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
                {!loading && pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-14 text-center">
                      <ClipboardList className="mx-auto mb-2 h-6 w-6 text-slate-400 dark:text-zinc-500" aria-hidden />
                      <p className="text-muted text-sm">
                        {listIsEmpty ? t('ingredients.empty') : items.length > 0 ? t('ingredients.emptyFiltered') : ''}
                      </p>
                      {listIsEmpty ? (
                        <button type="button" onClick={openAdd} className={`${ADD_BUTTON} mt-4`}>
                          <Plus className="h-4 w-4" aria-hidden />
                          {t('ingredients.addIngredient')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
                {pageItems.map((item) => {
                  const tone = STATUS_TONES[item.stock_status] || STATUS_TONES.IN_STOCK
                  return (
                    <tr key={item.id} className="table-row hover:bg-stone-50/50 dark:hover:bg-obsidian-900/20">
                      <td className="px-6 py-4">
                        <p className="text-heading text-sm font-semibold">{item.item_name}</p>
                        <p
                          className="text-muted mt-1 max-w-[18rem] truncate text-2xs"
                          title={(item.used_in || []).map((use) => use.name).join(', ')}
                        >
                          {item.used_in?.length
                            ? t('recipe.usedIn', { count: localizeDigits(item.used_in.length), names: item.used_in.map((use) => use.name).join(', ') })
                            : t('recipe.notUsed')}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-heading text-sm font-semibold tabular-nums">
                          {formatAmount(item.stock_quantity ?? 0)}
                          <span className="text-muted ml-1 text-xs font-normal">{item.unit_label}</span>
                        </p>
                        {purchaseSizeOf(item) ? (
                          <p className="text-muted mt-0.5 text-2xs tabular-nums">
                            {'≈ '}
                            {formatAmount(Number(item.stock_quantity ?? 0) / purchaseSizeOf(item), 1)} {item.purchase_unit}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <Pill tone={tone.pill} dot={tone.dot}>
                          {t(tone.key)}
                        </Pill>
                      </td>
                      <td className="px-6 py-4">
                        <div className="ml-auto flex w-fit items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
                          <Tooltip label={t('ingredients.adjust')} side="left">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'adjust', item })}
                              aria-label={t('ingredients.adjust')}
                              className={ACTION_BUTTON}
                            >
                              <Scale className="h-4 w-4" aria-hidden />
                            </button>
                          </Tooltip>
                          <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                          <Tooltip label={t('ingredients.history')} side="left">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'history', item })}
                              aria-label={t('ingredients.history')}
                              className={ACTION_BUTTON}
                            >
                              <History className="h-4 w-4" aria-hidden />
                            </button>
                          </Tooltip>
                          <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                          <Tooltip label={t('ingredients.convert')} side="left">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'convert', item })}
                              aria-label={t('ingredients.convert')}
                              className={ACTION_BUTTON}
                            >
                              <ArrowLeftRight className="h-4 w-4" aria-hidden />
                            </button>
                          </Tooltip>
                          <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                          <Tooltip label={t('ingredients.edit')} side="left">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'form', item })}
                              aria-label={t('ingredients.edit')}
                              className={ACTION_BUTTON}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                          </Tooltip>
                          <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                          <Tooltip label={t('ingredients.remove')} side="left">
                            <button
                              type="button"
                              onClick={() => setModal({ type: 'remove', item })}
                              aria-label={t('ingredients.remove')}
                              className={DANGER_ACTION_BUTTON}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </Tooltip>
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
                ? t('ingredients.showingRange', {
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

      {modal?.type === 'form' ? (
        <IngredientFormModal
          key={modal.item?.id ?? 'new'}
          item={modal.item}
          onClose={() => setModal(null)}
          onSaved={applyItem}
        />
      ) : null}
      {modal?.type === 'adjust' ? (
        <AdjustModal key={modal.item.id} item={modal.item} onClose={() => setModal(null)} onSaved={applyItem} />
      ) : null}
      {modal?.type === 'convert' ? (
        <ConvertModal key={modal.item.id} item={modal.item} onClose={() => setModal(null)} onSaved={applyItem} />
      ) : null}
      {modal?.type === 'history' ? (
        <HistoryModal key={modal.item.id} item={modal.item} onClose={() => setModal(null)} />
      ) : null}
      <ConfirmDeleteModal
        isOpen={modal?.type === 'remove'}
        title={t('ingredients.removeTitle')}
        itemName={modal?.type === 'remove' ? modal.item.item_name : ''}
        message={t('ingredients.removeMessage')}
        confirmLabel={t('ingredients.removeConfirm')}
        onCancel={() => !removing && setModal(null)}
        onConfirm={handleRemove}
      />
    </>
  )
}
