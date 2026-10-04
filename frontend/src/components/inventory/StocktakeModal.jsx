import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Search } from 'lucide-react'
import Modal from '../common/Modal'
import CategoryChips, { groupCategories } from './CategoryChips'
import { apiFetch, saveBlobAsDownload } from '../../services/apiClient'

const WHOLE_UNITS = new Set(['bottles', 'bottle', 'cans', 'can', 'eggs', 'egg', 'coconuts', 'coconut', 'tea bags', 'tea bag'])

function formatAmount(value, isWeight) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  const exact = Math.round(num * 1000) / 1000
  if (!isWeight && Number.isInteger(exact)) return exact
  return exact
}

// Display only: at most 2 decimals (5.982 → 5.98). Comparisons and saves keep the exact amount.
function formatSystemDisplay(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return String(Math.round(num * 100) / 100)
}

function allowsDecimal(item) {
  if (Number(item.is_weight) === 1) return true
  const unit = String(item.unit_label || '').trim().toLowerCase()
  // Condensed Milk (and similar) may be fractional cans after open-can recipes.
  if (unit === 'cans' || unit === 'can') return true
  return !WHOLE_UNITS.has(unit)
}

function parseField(text, item) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return { value: null }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { error: 'number' }
  const amount = Math.round(Number(trimmed) * 1000) / 1000
  if (!Number.isFinite(amount) || amount < 0) return { error: 'number' }
  if (!allowsDecimal(item) && !Number.isInteger(amount)) return { error: 'whole' }
  return { value: amount }
}

const ROWS_PER_PAGE = 10

const GRID_COLUMNS = 'grid-cols-[minmax(0,1fr)_80px_170px]'
const GRID_COLUMNS_WITH_MAX = 'grid-cols-[minmax(0,1fr)_80px_170px_110px]'

// Beyond this share of the system amount, a count difference is flagged as large.
const MAJOR_DIFF_RATIO = 0.2

/**
 * How a typed count compares with the system amount (UI only; nothing is saved from this).
 * state: 'empty' | 'invalid' | 'match' | 'minor' | 'major'
 */
function compareCount(item, text) {
  const count = parseField(text, item)
  if (count.error) return { state: 'invalid' }
  if (count.value == null) return { state: 'empty' }
  const system = formatAmount(item.stock_quantity, item.is_weight)
  const diff = Math.round((count.value - system) * 1000) / 1000
  if (diff === 0) return { state: 'match', diff }
  const major = system === 0 || Math.abs(diff) / Math.abs(system) > MAJOR_DIFF_RATIO
  return { state: major ? 'major' : 'minor', diff }
}

function formatSignedDiff(diff) {
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`
}

const COUNT_BORDER = {
  empty: 'border-slate-300 focus-within:border-forest-500 dark:border-zinc-700',
  match: 'border-emerald-400 dark:border-emerald-600',
  minor: 'border-amber-400 dark:border-amber-500',
  major: 'border-red-500',
  invalid: 'border-red-500',
  // New max: a clearly visible border so it reads as editable.
  editable: 'border-slate-400 focus-within:border-forest-500 dark:border-zinc-500',
  edited: 'border-forest-500 dark:border-forest-500',
}

const ROW_TINT = {
  minor: 'bg-amber-50/70 dark:bg-amber-950/20',
  major: 'bg-red-50/80 dark:bg-red-950/25',
  invalid: 'bg-red-50/80 dark:bg-red-950/25',
}

/** ✓ button that fills Counted with the system amount; turns green once the row matches. */
function MatchButton({ matched, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={matched}
      title={label}
      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/40 ${
        matched
          ? 'border-forest-500 bg-forest-500 text-white'
          : 'border-slate-300 text-slate-400 hover:border-forest-500 hover:text-forest-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:text-forest-400'
      }`}
    >
      <Check className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

/**
 * Compact number box with the unit shown inside on the right. The <label> wrapper
 * makes a click on the unit focus the input; spinners are hidden and the wheel can't change the value.
 */
function UnitNumberInput({ unit, item, tone = 'empty', hint, warning = false, marker = false, ...inputProps }) {
  return (
    <label
      title={hint}
      className={`flex h-[30px] w-full min-w-0 flex-1 cursor-text items-center gap-1.5 rounded-lg border px-2 transition-colors focus-within:ring-2 focus-within:ring-forest-500/20 ${COUNT_BORDER[tone]}`}
    >
      {warning ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" /> : null}
      {marker ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-forest-500" aria-hidden="true" /> : null}
      {/* w-0 + flex-1: without it the browser's default input width (~150px) sets a minimum
          that pushes the ✓ button out of the 170px Counted column. */}
      <input
        type="number"
        min="0"
        step={allowsDecimal(item) ? 'any' : '1'}
        inputMode="decimal"
        onWheel={(event) => event.currentTarget.blur()}
        className="w-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-sm tabular-nums text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        {...inputProps}
      />
      <span aria-hidden="true" className="shrink-0 text-xs text-slate-500 dark:text-zinc-400">{unit}</span>
    </label>
  )
}

function isLarge(before, after) {
  if (before === after) return false
  if (before === 0) return after !== 0
  return Math.abs(after - before) / Math.abs(before) > 0.5
}

function sectionRank(section) {
  if (section === 'countable') return 0
  if (section === 'uncountable') return 1
  return 2
}

export default function StocktakeModal({ items, onClose, onApplied }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState(null)
  const [counted, setCounted] = useState({})
  const [maximums, setMaximums] = useState({})
  // Max edits stay in state while hidden, but only count when the column is shown.
  const [editMax, setEditMax] = useState(false)
  const [step, setStep] = useState('edit')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  const rows = useMemo(() => {
    return items
      .filter((item) => !item.archived)
      .slice()
      .sort((a, b) => (
        sectionRank(a.section) - sectionRank(b.section)
        || String(a.category).localeCompare(String(b.category))
        || String(a.item_name).localeCompare(String(b.item_name))
      ))
  }, [items])

  const { categories, counts: categoryCounts } = useMemo(() => groupCategories(rows), [rows])
  const currentCategory = categories.includes(activeCategory) ? activeCategory : categories[0]
  const query = search.trim().toLowerCase()

  // Search looks across every category; otherwise show only the chosen chip's items.
  const visible = rows.filter((item) => {
    if (!query) return String(item.category || '').trim() === currentCategory
    return item.item_name.toLowerCase().includes(query) || String(item.category).toLowerCase().includes(query)
  })

  // Short pages keep the list from scrolling inside the modal.
  const [page, setPage] = useState(1)
  const [pagedView, setPagedView] = useState({ currentCategory, query })
  if (pagedView.currentCategory !== currentCategory || pagedView.query !== query) {
    setPagedView({ currentCategory, query })
    setPage(1)
  }
  const pageCount = Math.max(1, Math.ceil(visible.length / ROWS_PER_PAGE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = visible.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE)

  const isCounted = (item) => {
    const count = parseField(counted[item.id], item)
    return !count.error && count.value != null
  }
  const countedTotal = rows.filter(isCounted).length
  const categoryRows = rows.filter((item) => String(item.category || '').trim() === currentCategory)
  const categoryCounted = categoryRows.filter(isCounted).length
  const completedCategories = new Set(
    categories.filter((category) => rows
      .filter((item) => String(item.category || '').trim() === category)
      .every(isCounted)),
  )

  // Tally for the confirm step: short / over / not counted, plus names off by more than 20%.
  const outcome = { short: 0, over: 0, notCounted: 0, major: [] }
  for (const item of rows) {
    const comparison = compareCount(item, counted[item.id])
    if (comparison.state === 'minor' || comparison.state === 'major') {
      if (comparison.diff < 0) outcome.short += 1
      else outcome.over += 1
      if (comparison.state === 'major') outcome.major.push(item.item_name)
    } else if (comparison.state !== 'match') {
      outcome.notCounted += 1
    }
  }

  // Shown under the Apply button until the counts change again (a new counted object hides it).
  const [applyHint, setApplyHint] = useState(null)
  const visibleApplyHint = applyHint?.counted === counted ? applyHint.message : ''

  const selectCategory = (category) => {
    setActiveCategory(category)
    setSearch('')
  }

  const gridColumns = editMax ? GRID_COLUMNS_WITH_MAX : GRID_COLUMNS

  const countsRef = useRef(null)
  const countedInputs = () => [...(countsRef.current?.querySelectorAll('input[data-counted]') ?? [])]

  // Start each category, page (and the first open) with the cursor in the first Counted box.
  useEffect(() => {
    if (step === 'edit') countedInputs()[0]?.focus()
  }, [step, currentCategory, currentPage])

  const focusNextCount = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    const inputs = countedInputs()
    const next = inputs[inputs.indexOf(event.currentTarget) + 1]
    if (next) {
      next.focus()
      next.select()
    } else if (currentPage < pageCount) {
      setPage(currentPage + 1)
    }
  }

  const review = useMemo(() => {
    const changes = []
    let fieldError = ''
    for (const item of rows) {
      const count = parseField(counted[item.id], item)
      const max = parseField(editMax ? maximums[item.id] : '', item)
      if (count.error || max.error) {
        const kind = count.error || max.error
        fieldError = kind === 'whole'
          ? t('inventory.wholeNumber', { unit: item.unit_label })
          : `${item.item_name}: ${t('inventory.numberRequired')}`
        break
      }
      const before = formatAmount(item.stock_quantity, item.is_weight)
      const maxBefore = formatAmount(item.max_stock, item.is_weight)
      const countChanged = count.value != null && count.value !== before
      const maxChanged = max.value != null && max.value !== maxBefore
      if (!countChanged && !maxChanged) continue
      changes.push({
        id: item.id,
        name: item.item_name,
        unit: item.unit_label,
        before,
        after: countChanged ? count.value : before,
        difference: Math.round(((countChanged ? count.value : before) - before) * 1000) / 1000,
        maxBefore,
        maxAfter: maxChanged ? max.value : maxBefore,
        large: countChanged && isLarge(before, count.value),
        counted: counted[item.id] ?? '',
        max: editMax ? maximums[item.id] ?? '' : '',
      })
    }
    changes.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    return {
      fieldError,
      changes,
      blank: rows.length - changes.length,
      large: changes.filter((row) => row.large),
    }
  }, [rows, counted, maximums, editMax, t])

  const maxChanges = review.changes.filter((row) => row.maxAfter !== row.maxBefore).length

  const openSummary = () => {
    if (review.fieldError) {
      setError(review.fieldError)
      return
    }
    if (review.changes.length === 0) {
      setApplyHint({
        counted,
        message: countedTotal === 0 ? t('inventory.enterOneCount') : t('inventory.rowsChanged', { count: 0 }),
      })
      return
    }
    setApplyHint(null)
    setError('')
    setStep('summary')
  }

  const apply = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await apiFetch('/inventory/stocktake', {
        method: 'POST',
        body: JSON.stringify({
          confirmLarge: review.large.length > 0,
          rows: review.changes.map((row) => ({
            id: row.id,
            counted: row.counted,
            max: row.max,
          })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('inventory.invalidAmount'))
      setResult(data)
      setStep('done')
      onApplied()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const download = async () => {
    if (!result) return
    setError('')
    try {
      const response = await apiFetch('/inventory/stocktake/excel', {
        method: 'POST',
        body: JSON.stringify({ note: result.note, changed: result.changed }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || t('inventory.invalidAmount'))
      }
      const blob = await response.blob()
      const match = /filename="?([^"]+)"?/.exec(response.headers.get('Content-Disposition') || '')
      saveBlobAsDownload(blob, match?.[1] || 'Stocktake.xlsx')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal
      title={step === 'done' ? t('inventory.stocktakeComplete') : t('inventory.stocktakeTitle')}
      headerAlign="center"
      header={step === 'edit' ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h3 id="modal-title" className="text-heading shrink-0 text-lg">{t('inventory.stocktakeTitle')}</h3>
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('inventory.searchPlaceholder')}
              aria-label={t('inventory.searchPlaceholder')}
              className="input-field pl-10"
            />
          </div>
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 whitespace-nowrap text-sm text-slate-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={editMax}
              onChange={(event) => setEditMax(event.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-forest-500"
            />
            {t('inventory.editMax')}
          </label>
        </div>
      ) : undefined}
      onClose={onClose}
      closeLabel={t('a11y.close')}
      dismissible={!saving}
      maxWidth="max-w-4xl"
      footer={step === 'edit' ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4">
          <div className="min-w-[10rem] flex-1 sm:max-w-xs">
            <p className="text-muted text-sm tabular-nums">
              {t('inventory.countedProgress', { count: countedTotal, total: rows.length })}
            </p>
            {!query && currentCategory ? (
              <p className="text-muted text-xs tabular-nums">
                {t('inventory.countedInCategory', { count: categoryCounted, total: categoryRows.length })}
              </p>
            ) : null}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={rows.length}
              aria-valuenow={countedTotal}
              aria-label={t('inventory.countedProgress', { count: countedTotal, total: rows.length })}
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-700"
            >
              <div
                className="h-full rounded-full bg-forest-500 transition-all duration-300"
                style={{ width: `${rows.length ? (countedTotal / rows.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="btn-secondary px-4 py-2.5 text-sm">{t('common.cancel')}</button>
              <button
                type="button"
                onClick={openSummary}
                aria-describedby={visibleApplyHint ? 'stocktake-apply-hint' : undefined}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {review.changes.length > 0
                  ? t('inventory.applyWithChanges', { count: review.changes.length })
                  : t('inventory.applyStocktake')}
              </button>
            </div>
            {visibleApplyHint ? (
              <p id="stocktake-apply-hint" role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                {visibleApplyHint}
              </p>
            ) : null}
          </div>
        </div>
      ) : step === 'summary' ? (
        <>
          <button type="button" onClick={() => setStep('edit')} disabled={saving} className="btn-secondary px-4 py-2.5 text-sm">{t('inventory.backToCounts')}</button>
          <button type="button" onClick={apply} disabled={saving} className="btn-primary px-4 py-2.5 text-sm">
            {review.large.length || outcome.major.length ? t('inventory.confirmLarge') : t('inventory.applyStocktake')}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={download} className="btn-secondary px-4 py-2.5 text-sm">{t('inventory.downloadStocktake')}</button>
          <button type="button" onClick={onClose} className="btn-primary px-4 py-2.5 text-sm">{t('inventory.closeStocktake')}</button>
        </>
      )}
    >
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {step === 'edit' ? (
        <div ref={countsRef} className="space-y-4">
          {categories.length > 0 ? (
            <CategoryChips
              categories={categories}
              counts={categoryCounts}
              completed={completedCategories}
              active={query ? null : currentCategory}
              onSelect={selectCategory}
            />
          ) : null}
          {visible.length === 0 ? <p className="text-muted text-sm">{t('inventory.noMatches')}</p> : null}
          {visible.length > 0 ? (
            <div className="overflow-x-auto">
              <div role="table" aria-label={t('inventory.stocktakeTitle')} className="min-w-[30rem] text-sm">
                <div role="row" className={`table-head grid items-center gap-x-3 px-3 py-2 ${gridColumns}`}>
                  <span role="columnheader">{t('inventory.colItem')}</span>
                  <span role="columnheader" className="text-right">{t('inventory.colSystem')}</span>
                  <span role="columnheader" className="text-right">{t('inventory.colCounted')}</span>
                  {editMax ? <span role="columnheader" className="text-right">{t('inventory.colNewMax')}</span> : null}
                </div>
                {pageRows.map((item) => {
                  const comparison = compareCount(item, counted[item.id])
                  const currentMax = formatAmount(item.max_stock, item.is_weight)
                  const maxEntry = parseField(maximums[item.id], item)
                  const maxEdited = !maxEntry.error && maxEntry.value != null && maxEntry.value !== currentMax
                  const maxHint = t('inventory.maxChangedFrom', { value: currentMax })
                  const hint = comparison.state === 'match'
                    ? t('inventory.matchesSystem')
                    : comparison.state === 'invalid'
                      ? t('inventory.numberRequired')
                      : comparison.diff != null
                        ? t('inventory.diffVsSystem', { diff: formatSignedDiff(comparison.diff) })
                        : undefined
                  return (
                  <div key={item.id} role="row" className={`grid h-11 items-center gap-x-3 border-b border-border/60 px-3 transition-colors ${ROW_TINT[comparison.state] ?? ''} ${gridColumns}`}>
                    <div role="cell" className="min-w-0 truncate" title={`${item.item_name} · ${item.unit_label}`}>
                      <span className="font-medium">{item.item_name}</span>
                      <span className="text-xs text-slate-500 dark:text-zinc-400"> · {item.unit_label}</span>
                    </div>
                    <div role="cell" className="text-right tabular-nums" title={String(formatAmount(item.stock_quantity, item.is_weight))}>
                      {formatSystemDisplay(item.stock_quantity)}
                    </div>
                    <div role="cell" className="flex min-w-0 items-center gap-1.5">
                      <UnitNumberInput
                        item={item}
                        unit={item.unit_label}
                        value={counted[item.id] ?? ''}
                        onChange={(event) => setCounted((current) => ({ ...current, [item.id]: event.target.value }))}
                        onKeyDown={focusNextCount}
                        data-counted=""
                        tone={comparison.state}
                        hint={hint}
                        warning={comparison.state === 'major'}
                        aria-invalid={comparison.state === 'invalid' ? true : undefined}
                        aria-describedby={hint ? `count-hint-${item.id}` : undefined}
                        aria-label={`${item.item_name} ${t('inventory.countedQuantity')} (${item.unit_label})`}
                      />
                      {hint ? <span id={`count-hint-${item.id}`} className="sr-only">{hint}</span> : null}
                      <MatchButton
                        matched={comparison.state === 'match'}
                        label={`${t('inventory.matchesSystem')}: ${item.item_name}`}
                        onClick={() => setCounted((current) => ({
                          ...current,
                          [item.id]: String(formatAmount(item.stock_quantity, item.is_weight)),
                        }))}
                      />
                    </div>
                    {editMax ? (
                      <div role="cell" className="min-w-0">
                        <UnitNumberInput
                          item={item}
                          unit={item.unit_label}
                          // Starts as the current max (real text, not a grey placeholder); only an edit lands in state.
                          value={maximums[item.id] ?? String(formatAmount(item.max_stock, item.is_weight))}
                          onChange={(event) => setMaximums((current) => ({ ...current, [item.id]: event.target.value }))}
                          tone={maxEntry.error ? 'invalid' : maxEdited ? 'edited' : 'editable'}
                          aria-invalid={maxEntry.error ? true : undefined}
                          hint={maxEdited ? maxHint : undefined}
                          marker={maxEdited}
                          aria-describedby={maxEdited ? `max-hint-${item.id}` : undefined}
                          aria-label={`${item.item_name} ${t('inventory.newMaximum')} (${item.unit_label})`}
                        />
                        {maxEdited ? <span id={`max-hint-${item.id}`} className="sr-only">{maxHint}</span> : null}
                      </div>
                    ) : null}
                  </div>
                  )
                })}
              </div>
            </div>
          ) : null}
          {pageCount > 1 ? (
            <nav aria-label={t('inventory.paginationLabel')} className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                className="btn-secondary min-h-8 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('inventory.pageBack')}
              </button>
              <span className="text-muted px-1 text-xs tabular-nums" aria-live="polite">
                {t('inventory.pageOf', { page: currentPage, total: pageCount })}
              </span>
              <button
                type="button"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
                className="btn-secondary min-h-8 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('common.next')}
              </button>
            </nav>
          ) : null}
        </div>
      ) : null}
      {step === 'summary' ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">{t('inventory.stocktakeSummary')}</p>
          <p className="text-base font-medium">
            {[
              t('inventory.itemsShort', { count: outcome.short }),
              t('inventory.itemsOver', { count: outcome.over }),
              t('inventory.itemsNotCounted', { count: outcome.notCounted }),
            ].join(', ')}
          </p>
          {maxChanges > 0 ? <p>{t('inventory.maxChangesCount', { count: maxChanges })}</p> : null}
          {outcome.major.length ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-900 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-100">
              <p className="font-medium">{t('inventory.majorDifferences', { count: outcome.major.length })}</p>
              <p className="mt-0.5">{outcome.major.join(', ')}</p>
            </div>
          ) : null}
          <div>
            <p className="font-medium">{t('inventory.largestDifferences')}</p>
            <ul className="mt-2 space-y-1">
              {review.changes.slice(0, 5).map((row) => (
                <li key={row.id} className="tabular-nums">
                  {row.name}: {row.before} → {row.after} {row.unit}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {step === 'done' && result ? (
        <div className="space-y-3 text-sm">
          <p>{t('inventory.stocktakeSaved', { count: result.changed.length, blank: result.blank })}</p>
          <ul className="space-y-1">
            {result.changed.map((row) => (
              <li key={row.id} className="tabular-nums">
                {row.name}: {row.before} → {row.after} {row.unit}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  )
}
