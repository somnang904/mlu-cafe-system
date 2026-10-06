import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, CircleCheck } from 'lucide-react'

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

const CATEGORY_PRIORITY = [
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

export function inventoryCategoryLabel(category, t) {
  const key = INVENTORY_CATEGORY_KEYS[category]
  if (key) {
    return t(`inventory.categories.${key}`, { defaultValue: category })
  }
  return category
}

/** Distinct categories in display order, plus how many items each holds. */
export function groupCategories(items) {
  const counts = {}
  items.forEach((item) => {
    const cat = String(item.category || '').trim()
    if (cat) counts[cat] = (counts[cat] || 0) + 1
  })
  const categories = Object.keys(counts).sort((a, b) => {
    const indexA = CATEGORY_PRIORITY.indexOf(a)
    const indexB = CATEGORY_PRIORITY.indexOf(b)
    if (indexA !== -1 && indexB !== -1) return indexA - indexB
    if (indexA !== -1) return -1
    if (indexB !== -1) return 1
    return a.localeCompare(b)
  })
  return { categories, counts }
}

// Gap between the chip and its menu, and the minimum distance kept from the window edges.
const MENU_GAP = 8
const MENU_EDGE = 12
const MENU_MAX_HEIGHT = 240

// Visible keyboard focus on chips (an outline, so it sits outside the selected chip's ring).
const CHIP_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-forest-600 dark:focus-visible:outline-forest-400'

/**
 * "More" chip that opens a list of the remaining options. `counts` is optional;
 * `getLabel` defaults to stock category names. The list is portalled to <body> with
 * fixed positioning so a scrolling parent (e.g. a modal body) can't clip it.
 * `align="end"` lines the list up with the chip's right edge.
 */
export function CategoryMoreMenu({
  categories,
  counts,
  activeFilter,
  onSelect,
  getLabel = inventoryCategoryLabel,
  activeClassName = 'tab-pill-active',
  inactiveClassName = 'tab-pill-inactive',
  completed,
  align = 'start',
  buttonRef: externalButtonRef,
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const localButtonRef = useRef(null)
  const buttonRef = externalButtonRef ?? localButtonRef
  const panelRef = useRef(null)
  const listRef = useRef(null)
  const headingId = useId()
  const activeInMenu = categories.includes(activeFilter)

  useEffect(() => {
    if (!open) return undefined
    const handlePointer = (event) => {
      if (buttonRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return
      setOpen(false)
    }
    // Capture phase + stopPropagation: Escape closes only the menu, not a modal underneath.
    const handleKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointer)
    window.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('keydown', handleKey, true)
    }
  }, [open, buttonRef])

  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - MENU_EDGE
      const spaceAbove = rect.top - MENU_GAP - MENU_EDGE
      const below = spaceBelow >= 200 || spaceBelow >= spaceAbove
      setPosition({
        ...(below
          ? { top: rect.bottom + MENU_GAP }
          : { bottom: window.innerHeight - rect.top + MENU_GAP }),
        ...(align === 'end'
          ? { right: Math.max(MENU_EDGE, window.innerWidth - rect.right) }
          : { left: Math.max(MENU_EDGE, rect.left) }),
        maxHeight: Math.min(MENU_MAX_HEIGHT, below ? spaceBelow : spaceAbove),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align, buttonRef])

  const menuItems = () => [...(listRef.current?.querySelectorAll('[role="option"]') ?? [])]

  // Once the list is placed, move focus to the selected row (or the first) so arrows work at once.
  const placed = position != null
  useEffect(() => {
    if (!open || !placed) return
    const items = menuItems()
    const selected = items.find((item) => item.getAttribute('aria-selected') === 'true')
    ;(selected ?? items[0])?.focus()
  }, [open, placed])

  // Arrow keys / Home / End move between rows; Enter clicks the focused row (native button);
  // Tab closes the menu and returns focus to the chip.
  const handleMenuKey = (event) => {
    const items = menuItems()
    if (!items.length) return
    const index = items.indexOf(document.activeElement)
    let next = null
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length]
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length]
    else if (event.key === 'Home') next = items[0]
    else if (event.key === 'End') next = items[items.length - 1]
    else if (event.key === 'Tab') {
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`tab-pill ${CHIP_FOCUS} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${activeInMenu ? activeClassName : inactiveClassName}`}
      >
        {activeInMenu && completed?.has(activeFilter) ? <DoneMark /> : null}
        {activeInMenu
          ? `${getLabel(activeFilter, t)}${counts ? ` (${counts[activeFilter] ?? 0})` : ''}`
          : t('inventory.moreCategories')}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && position ? createPortal(
        // Capped at 260px wide: right-aligned in the stocktake modal it stays over the
        // System/Counted columns (≈286px) and never covers the Item column.
        <div
          ref={panelRef}
          style={position}
          className="fixed z-[130] flex w-max min-w-[230px] max-w-[min(260px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-border bg-white p-1.5 shadow-lg dark:bg-card"
        >
          <p id={headingId} className="shrink-0 px-3 pb-1 pt-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
            {t('inventory.moreCategoriesHeading')}
          </p>
          <div
            ref={listRef}
            role="listbox"
            aria-labelledby={headingId}
            onKeyDown={handleMenuKey}
            className="min-h-0 overflow-y-auto overscroll-contain"
          >
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                role="option"
                aria-selected={activeFilter === category}
                tabIndex={-1}
                onClick={() => {
                  onSelect(category)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest-500 ${
                  activeFilter === category
                    ? 'bg-forest-50 font-medium text-forest-700 dark:bg-forest-500/15 dark:text-forest-300'
                    : 'text-slate-700 hover:bg-slate-100 focus:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5" title={getLabel(category, t)}>
                  {completed?.has(category) ? <DoneMark /> : null}
                  <span className="truncate">{getLabel(category, t)}</span>
                </span>
                {counts ? <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-zinc-400">{counts[category] ?? 0}</span> : null}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

/** Green ✓ for a category whose items are all done; the hidden text keeps it from being colour/icon-only. */
function DoneMark() {
  const { t } = useTranslation()
  return (
    <>
      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden="true" />
      <span className="sr-only">{t('inventory.categoryDone')}: </span>
    </>
  )
}

// Selected chip in the single-row layout: light green fill, green outline and text, weight 500.
// Inactive chips are also weight 500 so selecting one never changes its width.
const ROW_CHIP_ACTIVE = 'bg-forest-50 font-medium text-forest-700 ring-1 ring-forest-500 dark:bg-forest-500/15 dark:text-forest-300'
const ROW_CHIP_INACTIVE = 'tab-pill-inactive font-medium!'

/**
 * One row of chips that never wraps: `leading` chips (e.g. All) first, then as many categories
 * as fit; the rest go in a "More" chip pinned to the right. Room for the More chip is sized for
 * its widest possible label, so picking a category never shifts the row.
 */
function SingleRowChips({ categories, counts, active, onSelect, completed, leading = [] }) {
  const { t } = useTranslation()
  const rowRef = useRef(null)
  const measureRef = useRef(null)
  const moreRef = useRef(null)
  const [fitCount, setFitCount] = useState(categories.length)

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return undefined
    const recalc = () => {
      const widths = [...measure.querySelectorAll('[data-measure]')].map((node) => node.offsetWidth)
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      const leadingWidths = widths.slice(0, leading.length)
      const chipWidths = widths.slice(leading.length, leading.length + categories.length)
      const moreLabelWidth = widths[widths.length - 1]
      const chevron = 22 // ChevronDown + its gap
      const available = row.clientWidth - 8 // minus the p-1 that keeps the selected ring and focus outline visible
      const used = leadingWidths.reduce((sum, width) => sum + width + gap, 0)
      const total = used + chipWidths.reduce((sum, width) => sum + width + gap, 0) - gap
      if (total <= available) {
        setFitCount(categories.length)
        return
      }
      let next = 0
      for (let count = categories.length - 1; count >= 0; count -= 1) {
        const rest = chipWidths.slice(count)
        const moreWidth = Math.max(moreLabelWidth, ...rest) + chevron
        const inline = chipWidths.slice(0, count).reduce((sum, width) => sum + width + gap, 0)
        if (used + inline + moreWidth <= available) {
          next = count
          break
        }
      }
      setFitCount(next)
    }
    recalc()
    const observer = new ResizeObserver(recalc)
    observer.observe(row)
    return () => observer.disconnect()
  }, [categories, counts, completed, leading.length])

  const visible = categories.slice(0, fitCount)
  const overflow = categories.slice(fitCount)
  const chipClass = (selected) => `tab-pill ${CHIP_FOCUS} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${selected ? ROW_CHIP_ACTIVE : ROW_CHIP_INACTIVE}`
  const chipContent = (category) => (
    <>
      {completed?.has(category) ? <DoneMark /> : null}
      {inventoryCategoryLabel(category, t)} ({counts[category] ?? 0})
    </>
  )

  return (
    <div className="relative">
      {/* Off-screen copy of every chip, used only to measure widths. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex gap-2">
        {leading.map((chip) => (
          <span key={chip.key} data-measure className={chipClass(false)}>{chip.label}</span>
        ))}
        {categories.map((category) => (
          <span key={category} data-measure className={chipClass(false)}>{chipContent(category)}</span>
        ))}
        <span data-measure className={chipClass(false)}>{t('inventory.moreCategories')}</span>
      </div>
      <div ref={rowRef} className="flex flex-nowrap items-center gap-2 overflow-hidden p-1">
        {leading.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.onSelect}
            aria-pressed={chip.selected}
            className={chipClass(chip.selected)}
          >
            {chip.label}
          </button>
        ))}
        {visible.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(category)}
            aria-pressed={active === category}
            className={chipClass(active === category)}
          >
            {chipContent(category)}
          </button>
        ))}
        {overflow.length > 0 ? (
          <div className="ml-auto shrink-0">
            <CategoryMoreMenu
              categories={overflow}
              counts={counts}
              activeFilter={active}
              onSelect={onSelect}
              completed={completed}
              activeClassName={ROW_CHIP_ACTIVE}
              inactiveClassName={ROW_CHIP_INACTIVE}
              align="end"
              buttonRef={moreRef}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Category chips with counts; the first `visibleCount` show inline and the rest go in a "More" dropdown.
 * `children` render before the category chips (e.g. All or status chips).
 * `completed` (optional Set) marks finished categories with a ✓.
 * `singleRow` keeps every chip on one line instead, fitting as many as the width allows;
 * `leading` ({ key, label, selected, onSelect }[]) are the chips placed before the categories there.
 */
export default function CategoryChips({ categories, counts, active, onSelect, visibleCount = 6, completed, singleRow = false, leading, children }) {
  const { t } = useTranslation()
  if (singleRow) {
    return (
      <SingleRowChips
        categories={categories}
        counts={counts}
        active={active}
        onSelect={onSelect}
        completed={completed}
        leading={leading}
      />
    )
  }

  const visible = categories.slice(0, visibleCount)
  const overflow = categories.slice(visibleCount)

  return (
    <div className="flex flex-wrap gap-2">
      {children}
      {visible.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onSelect(category)}
          aria-pressed={active === category}
          className={`tab-pill ${CHIP_FOCUS} inline-flex items-center gap-1.5 ${active === category ? 'tab-pill-active' : 'tab-pill-inactive'}`}
        >
          {completed?.has(category) ? <DoneMark /> : null}
          {inventoryCategoryLabel(category, t)} ({counts[category] ?? 0})
        </button>
      ))}
      {overflow.length > 0 ? (
        <div className="relative">
          <CategoryMoreMenu categories={overflow} counts={counts} activeFilter={active} onSelect={onSelect} completed={completed} />
        </div>
      ) : null}
    </div>
  )
}
