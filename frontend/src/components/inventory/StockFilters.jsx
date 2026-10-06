import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Tag, X } from 'lucide-react'
import { inventoryCategoryLabel } from './CategoryChips'
import { STOCK_STATUS } from '../../utils/stockStatus'

// Tab order runs best to worst; the active underline takes the status colour (All shares In stock's green).
export const STATUS_TABS = [
  { key: 'all', labelKey: 'inventory.statusTabs.all', underline: 'bg-forest-500' },
  { key: STOCK_STATUS.IN, labelKey: 'inventory.statusTabs.in', underline: 'bg-forest-500' },
  { key: STOCK_STATUS.LOW, labelKey: 'inventory.statusTabs.low', underline: 'bg-amber-500' },
  { key: STOCK_STATUS.OUT, labelKey: 'inventory.statusTabs.out', underline: 'bg-red-500' },
]

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/50'

/** `panelId` is the id of the element the tabs filter; each tab gets the id `${panelId}-tab-${key}`. */
export function StatusTabs({ active, counts, onChange, panelId }) {
  const { t } = useTranslation()
  const tabRefs = useRef([])

  // Arrow keys move between tabs (and select them), as in the WAI-ARIA tabs pattern.
  const handleKeyDown = (event, index) => {
    let next = null
    if (event.key === 'ArrowRight') next = (index + 1) % STATUS_TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + STATUS_TABS.length) % STATUS_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = STATUS_TABS.length - 1
    if (next == null) return
    event.preventDefault()
    onChange(STATUS_TABS[next].key)
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={t('inventory.statusTabsLabel')}
      className="-mb-px flex min-w-0 items-end gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {STATUS_TABS.map((tab, index) => {
        const selected = active === tab.key
        return (
          <button
            key={tab.key}
            ref={(node) => {
              tabRefs.current[index] = node
            }}
            type="button"
            id={`${panelId}-tab-${tab.key}`}
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3 text-sm transition-colors ${FOCUS_RING} focus-visible:ring-inset ${
              selected
                ? 'font-semibold text-slate-900 dark:text-zinc-100'
                : 'font-medium text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {t(tab.labelKey)}
            <span
              className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-2xs font-semibold tabular-nums ${
                selected
                  ? 'bg-slate-900/10 text-slate-900 dark:bg-zinc-100/15 dark:text-zinc-100'
                  : 'bg-slate-200/80 text-slate-600 dark:bg-zinc-700/70 dark:text-zinc-300'
              }`}
            >
              {counts[tab.key] ?? 0}
            </span>
            {selected ? (
              <span aria-hidden="true" className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full ${tab.underline}`} />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Categories by item count (most first), ties A–Z by their shown label. */
function sortCategories(categories, counts, t) {
  return [...categories].sort(
    (a, b) =>
      (counts[b] ?? 0) - (counts[a] ?? 0) ||
      inventoryCategoryLabel(a, t).localeCompare(inventoryCategoryLabel(b, t), undefined, { sensitivity: 'base' }),
  )
}

/**
 * "Category ⌄" pill with a searchable list. Picking a category turns the pill light green with
 * "Produce (30) ✕"; ✕ or picking the same category again clears it. `value` is null when unset.
 */
export function CategoryFilter({ categories, counts, value, onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Highlight only follows hover or ↑/↓ (-1 = nothing highlighted).
  const [activeIndex, setActiveIndex] = useState(-1)
  const wrapperRef = useRef(null)
  const triggerRef = useRef(null)
  const inputRef = useRef(null)
  const optionRefs = useRef([])
  const listId = useId()
  const optionId = (index) => `${listId}-option-${index}`

  const sorted = useMemo(() => sortCategories(categories, counts, t), [categories, counts, t])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter((category) => inventoryCategoryLabel(category, t).toLowerCase().includes(needle))
  }, [sorted, query, t])

  const close = (restoreFocus) => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const handlePointer = (event) => {
      if (wrapperRef.current?.contains(event.target)) return
      setOpen(false)
      setQuery('')
      setActiveIndex(-1)
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [open])

  useEffect(() => {
    if (activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const pick = (category) => {
    onChange(category === value ? null : category)
    close(true)
  }

  const handleInputKeyDown = (event) => {
    const count = shown.length
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      close(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0 && shown[activeIndex]) pick(shown[activeIndex])
      return
    }
    if (!count) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % count)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? count - 1 : index - 1))
    }
  }

  const selectedLabel = value ? `${inventoryCategoryLabel(value, t)} (${counts[value] ?? 0})` : null

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <div
        className={`inline-flex min-h-9 items-center rounded-full text-sm font-medium transition-colors ${
          value
            ? 'bg-forest-50 text-forest-700 ring-1 ring-forest-500 dark:bg-forest-500/15 dark:text-forest-300'
            : 'tab-pill-inactive'
        }`}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? close(false) : setOpen(true))}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
              event.preventDefault()
              setOpen(true)
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={value ? `${t('inventory.categoryFilter')}: ${selectedLabel}` : undefined}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full py-1.5 pl-3.5 ${value ? 'pr-1.5' : 'pr-3'} ${FOCUS_RING}`}
        >
          <Tag className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="max-w-[12rem] truncate">{selectedLabel ?? t('inventory.categoryFilter')}</span>
          {value ? null : (
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          )}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange(null)
              close(false)
              triggerRef.current?.focus()
            }}
            aria-label={t('inventory.clearCategory')}
            title={t('inventory.clearCategory')}
            className={`mr-1 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-forest-500/15 ${FOCUS_RING}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-white p-1.5 shadow-xl ring-1 ring-black/5 md:left-auto md:right-0 dark:border-zinc-700/80 dark:bg-zinc-900">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-label={t('inventory.searchCategory')}
            placeholder={t('inventory.searchCategory')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(-1)
            }}
            onKeyDown={handleInputKeyDown}
            className="input-field mb-1.5 w-full py-2 text-sm"
            autoComplete="off"
          />
          <div
            id={listId}
            role="listbox"
            aria-label={t('inventory.categoryFilter')}
            onMouseLeave={() => setActiveIndex(-1)}
            className="max-h-[230px] overflow-y-auto overscroll-contain"
          >
            {shown.map((category, index) => {
              const selected = category === value
              return (
                <div
                  key={category}
                  id={optionId(index)}
                  ref={(node) => {
                    optionRefs.current[index] = node
                  }}
                  role="option"
                  aria-selected={selected}
                  data-active={index === activeIndex || undefined}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => pick(category)}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-sm data-[active]:bg-slate-100 dark:data-[active]:bg-zinc-800 ${
                    selected ? 'font-semibold text-forest-700 dark:text-forest-400' : 'text-slate-700 dark:text-zinc-300'
                  }`}
                >
                  <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
                    {selected ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={inventoryCategoryLabel(category, t)}>
                    {inventoryCategoryLabel(category, t)}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-zinc-400">{counts[category] ?? 0}</span>
                </div>
              )
            })}
            {shown.length === 0 ? (
              <p role="presentation" className="px-3 py-2.5 text-sm text-slate-500 dark:text-zinc-400">
                {t('inventory.noCategoryFound')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
