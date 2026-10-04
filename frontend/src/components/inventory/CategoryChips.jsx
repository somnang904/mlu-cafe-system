import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'

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

/**
 * "More" chip that opens a list of the remaining options. `counts` is optional;
 * `getLabel` defaults to stock category names.
 */
export function CategoryMoreMenu({
  categories,
  counts,
  activeFilter,
  onSelect,
  getLabel = inventoryCategoryLabel,
  activeClassName = 'tab-pill-active',
  completed,
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const activeInMenu = categories.includes(activeFilter)

  useEffect(() => {
    if (!open) return undefined
    const handlePointer = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`tab-pill inline-flex items-center gap-1.5 ${activeInMenu ? activeClassName : 'tab-pill-inactive'}`}
      >
        {activeInMenu
          ? `${getLabel(activeFilter, t)}${counts ? ` (${counts[activeFilter] ?? 0})` : ''}`
          : t('inventory.moreCategories')}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-2 max-h-72 min-w-48 overflow-y-auto rounded-2xl border border-border bg-white p-1.5 shadow-lg dark:bg-card"
        >
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              role="menuitemradio"
              aria-checked={activeFilter === category}
              onClick={() => {
                onSelect(category)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left text-sm ${
                activeFilter === category
                  ? 'bg-forest-500/10 font-semibold text-forest-700 dark:text-forest-300'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {completed?.has(category) ? <DoneMark /> : null}
                {getLabel(category, t)}
              </span>
              {counts ? <span className="text-xs text-slate-500 dark:text-zinc-400">{counts[category] ?? 0}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Category chips with counts; the first `visibleCount` show inline and the rest go in a "More" dropdown.
 * `children` render before the category chips (e.g. All or status chips).
 */
/** ✓ for a category whose items are all done; the hidden text keeps it from being colour/icon-only. */
function DoneMark() {
  const { t } = useTranslation()
  return (
    <>
      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('inventory.categoryDone')}: </span>
    </>
  )
}

/** `completed` (optional Set) marks finished categories with a ✓. */
export default function CategoryChips({ categories, counts, active, onSelect, visibleCount = 6, completed, children }) {
  const { t } = useTranslation()
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
          className={`tab-pill inline-flex items-center gap-1.5 ${active === category ? 'tab-pill-active' : 'tab-pill-inactive'}`}
        >
          {completed?.has(category) ? <DoneMark /> : null}
          {inventoryCategoryLabel(category, t)} ({counts[category] ?? 0})
        </button>
      ))}
      {overflow.length > 0 ? (
        <CategoryMoreMenu categories={overflow} counts={counts} activeFilter={active} onSelect={onSelect} completed={completed} />
      ) : null}
    </div>
  )
}
