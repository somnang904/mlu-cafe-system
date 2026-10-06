import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  Box,
  Boxes,
  ChefHat,
  ChevronDown,
  CupSoda,
  Egg,
  Hash,
  History,
  Layers,
  Link2,
  Milk,
  Package,
  Pencil,
  PackagePlus,
  Plus,
  Ruler,
  Scale,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  StickyNote,
  Tag,
  Trash2,
  Utensils,
  Wine,
  Wrench,
} from 'lucide-react'
import Modal from '../components/common/Modal'
import StocktakeModal from '../components/inventory/StocktakeModal'
import { groupCategories } from '../components/inventory/CategoryChips'
import { CategoryFilter, StatusTabs } from '../components/inventory/StockFilters'
import ExpenseLogModal from '../components/finance/ExpenseLogModal'
import StatusBadge from '../components/common/StatusBadge'
import FieldLabel from '../components/ui/FieldLabel'
import IconSelect from '../components/ui/IconSelect'
import ModalHeader from '../components/ui/ModalHeader'
import { useAuth } from '../context/AuthContext'
import { userHasPermission } from '../utils/permissions'
import { apiFetch } from '../services/apiClient'
import { useActionBanner } from '../hooks/useActionBanner'
import { cacheInventoryItems, getInventoryFallback } from '../utils/offlineFallbacks'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import { STOCK_STATUS, getStockRatio, getStockStatus, stockStatusRank } from '../utils/stockStatus'

// Out of stock = red, Low = amber, In stock = green; the badge always carries the status text too.
const statusStyles = {
  [STOCK_STATUS.IN]:
    'border border-emerald-500/30 bg-emerald-500/10 text-emerald-950 font-bold dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/30 ring-1 ring-emerald-500/30',
  [STOCK_STATUS.LOW]:
    'bg-amber-500/15 text-amber-950 font-bold ring-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-500/30 ring-1',
  [STOCK_STATUS.OUT]:
    'bg-rose-500/15 text-rose-950 font-bold ring-rose-500/40 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-500/30 ring-1',
}

function compareNames(a, b) {
  return String(a.item_name || '').localeCompare(String(b.item_name || ''), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Default order: Out of stock first, then Low (emptiest first), then In stock A–Z.
 * Also the Status column's ascending order.
 */
function compareStockUrgency(a, b) {
  const statusA = getStockStatus(a)
  const statusB = getStockStatus(b)
  const byStatus = stockStatusRank(statusA) - stockStatusRank(statusB)
  if (byStatus !== 0) return byStatus
  if (statusA === STOCK_STATUS.LOW) return getStockRatio(a) - getStockRatio(b) || compareNames(a, b)
  return compareNames(a, b)
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

const progressColors = {
  [STOCK_STATUS.IN]: 'bg-emerald-500',
  [STOCK_STATUS.LOW]: 'bg-amber-500',
  [STOCK_STATUS.OUT]: 'bg-red-500',
}

// The list only needs a glance-level figure (at most 2 decimals); modals keep the exact 3-decimal amounts.
function formatListAmount(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '0'
  return String(Math.round(num * 100) / 100)
}

// Short labels so the badge fits the 104px Status column.
const STATUS_LABEL_KEYS = {
  [STOCK_STATUS.IN]: 'inventory.statusShort.inStock',
  [STOCK_STATUS.LOW]: 'inventory.statusShort.low',
  [STOCK_STATUS.OUT]: 'inventory.statusShort.out',
}

function StockLevel({ item }) {
  const status = getStockStatus(item)
  // Out of stock always shows an empty bar.
  const fill = status === STOCK_STATUS.OUT ? 0 : getStockRatio(item) * 100

  return (
    <div className="min-w-0 max-w-[190px]">
      <p className="truncate text-sm tabular-nums">
        <span className="text-heading font-semibold">{formatListAmount(item.stock_quantity)}</span>
        <span className="text-slate-500 dark:text-zinc-400"> / {formatListAmount(item.max_stock)} {item.unit_label}</span>
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${progressColors[status]}`}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  )
}

function RecipeBadge({ links }) {
  const { t } = useTranslation()

  return (
    <div className="group relative inline-block">
      <span
        tabIndex={0}
        className="inline-flex cursor-default select-none items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-2xs font-medium text-emerald-800 transition-colors hover:bg-emerald-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/40 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
        title={links.map((link) => link.menu_name).join(', ')}
      >
        <Link2 className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        {t('inventory.linkedRecipesCount', { count: links.length })}
      </span>
      <div className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-stone-200/90 bg-white/95 p-3 opacity-0 shadow-xl ring-1 ring-black/5 backdrop-blur-md transition-all duration-150 ease-out group-focus-within:visible group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 dark:border-zinc-700/80 dark:bg-zinc-900/95">
        <div className="mb-2 flex items-center justify-between border-b border-stone-200/60 pb-1.5 dark:border-zinc-800">
          <span className="flex items-center gap-1.5 text-2xs font-semibold text-stone-700 dark:text-zinc-200">
            <Link2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            {t('inventory.linkedRecipesTitle', { count: links.length })}
          </span>
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-2xs font-bold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
            {links.length}
          </span>
        </div>
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs font-normal">
          {links.map((link, idx) => (
            <li
              key={link.menu_id || idx}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-stone-600 dark:text-zinc-300"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">{link.menu_name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const ROW_MENU_GAP = 6
const ROW_MENU_EDGE = 8

// Only one row menu may be open; opening another closes the previous one.
let closeOpenRowMenu = null

function RowActionsMenu({ item, actions }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  // The one highlighted item, shared by hover and keyboard (-1 = none).
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const menuRef = useRef(null)
  const itemRefs = useRef([])
  const closerRef = useRef(null)

  const close = useCallback((restoreFocus) => {
    setOpen(false)
    setPosition(null)
    setActiveIndex(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  // Keyboard opens with the first item highlighted; a mouse click opens with none.
  const openMenu = (fromKeyboard) => {
    if (closeOpenRowMenu !== closerRef.current) closeOpenRowMenu?.()
    closerRef.current = () => close(false)
    closeOpenRowMenu = closerRef.current
    setActiveIndex(fromKeyboard ? 0 : -1)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return undefined
    const handlePointer = (event) => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return
      close(false)
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') close(true)
    }
    const handleScrollOrResize = () => close(false)
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
      if (closeOpenRowMenu === closerRef.current) closeOpenRowMenu = null
    }
  }, [open, close])

  // Measure the rendered panel, then pin its right edge to the trigger's; flip up when it won't fit below.
  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? 0
    if (!rect) return
    const spaceBelow = window.innerHeight - rect.bottom - ROW_MENU_GAP - ROW_MENU_EDGE
    const spaceAbove = rect.top - ROW_MENU_GAP - ROW_MENU_EDGE
    const below = height <= spaceBelow || spaceBelow >= spaceAbove
    setPosition({
      ...(below
        ? { top: rect.bottom + ROW_MENU_GAP }
        : { bottom: window.innerHeight - rect.top + ROW_MENU_GAP }),
      right: Math.max(ROW_MENU_EDGE, window.innerWidth - rect.right),
    })
  }, [open])

  // Keep DOM focus on the highlighted item, or on the menu itself when nothing is highlighted.
  const placed = position != null
  useEffect(() => {
    if (!open || !placed) return
    const target = activeIndex >= 0 ? itemRefs.current[activeIndex] : menuRef.current
    target?.focus({ preventScroll: true })
  }, [open, placed, activeIndex])

  const handleMenuKeyDown = (event) => {
    const count = actions.length
    let next = null
    if (event.key === 'ArrowDown') next = activeIndex < 0 ? 0 : (activeIndex + 1) % count
    else if (event.key === 'ArrowUp') next = activeIndex < 0 ? count - 1 : (activeIndex - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    } else if (event.key === 'Tab') {
      close(false)
      return
    }
    if (next == null) return
    event.preventDefault()
    setActiveIndex(next)
  }

  const menuLabel = `${t('common.actions')}: ${item.item_name}`

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        // detail === 0 means the click came from Enter/Space rather than a pointer.
        onClick={(event) => (open ? close(false) : openMenu(event.detail === 0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            openMenu(true)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('inventory.moreActions', { item: item.item_name })}
        title={t('inventory.moreActions', { item: item.item_name })}
        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 ring-1 ring-slate-300/80 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/50 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? createPortal(
        // Portalled to <body> so the card's overflow can't clip it; hidden until measured and placed.
        <div
          ref={panelRef}
          style={position ?? { top: 0, right: 0, visibility: 'hidden' }}
          className="fixed z-[60] w-56 rounded-2xl border border-border bg-white p-1.5 shadow-xl ring-1 ring-black/5 dark:bg-card"
        >
          <div
            ref={menuRef}
            role="menu"
            tabIndex={-1}
            aria-label={menuLabel}
            onKeyDown={handleMenuKeyDown}
            onMouseLeave={() => setActiveIndex(-1)}
            className="focus:outline-none"
          >
            {actions.map((action, index) => {
              const Icon = action.icon
              return (
                <button
                  key={action.key}
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-active={index === activeIndex || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    close(false)
                    action.onSelect()
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm md:min-h-0 text-slate-700 focus:outline-none data-[active]:bg-slate-100 data-[active]:text-slate-900 dark:text-zinc-300 dark:data-[active]:bg-zinc-800 dark:data-[active]:text-zinc-100"
                >
                  {Icon ? <Icon className="h-4 w-4 shrink-0 text-slate-500 dark:text-zinc-400" aria-hidden="true" /> : null}
                  <span className="truncate">{action.label}</span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

const ITEMS_PER_PAGE = 10

// Always shows first, last and the pages around the current one, e.g. 1 2 3 … 5 or 1 … 4 5 6 … 9.
function getPageList(current, total) {
  let start = Math.max(1, current - 1)
  let end = Math.min(total, current + 1)
  if (current <= 2) end = Math.min(total, 3)
  if (current >= total - 1) start = Math.max(1, total - 2)
  const pages = new Set([1, total])
  for (let page = start; page <= end; page += 1) pages.add(page)
  const sorted = [...pages].sort((a, b) => a - b)
  return sorted.flatMap((page, index) => (index > 0 && page - sorted[index - 1] > 1 ? ['gap-' + page, page] : [page]))
}

function ListPagination({ page, pageCount, total, onPageChange }) {
  const { t } = useTranslation()
  const from = (page - 1) * ITEMS_PER_PAGE + 1
  const to = Math.min(page * ITEMS_PER_PAGE, total)
  const navButton =
    'flex h-9 items-center justify-center rounded-full px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300/80 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800'

  return (
    <div className="flex flex-col gap-3 border-t border-slate-300/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-zinc-700/70">
      <p className="text-muted text-sm tabular-nums">{t('inventory.showingRange', { from, to, total })}</p>
      <nav aria-label={t('inventory.paginationLabel')} className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={navButton}>
          {t('inventory.pageBack')}
        </button>
        {getPageList(page, pageCount).map((entry) =>
          typeof entry === 'string' ? (
            <span key={entry} aria-hidden="true" className="px-1 text-sm text-slate-400 dark:text-zinc-500">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-label={t('inventory.pageNumber', { page: entry })}
              aria-current={entry === page ? 'page' : undefined}
              className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/50 ${
                entry === page
                  ? 'bg-forest-500 font-semibold text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {entry}
            </button>
          ),
        )}
        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} className={navButton}>
          {t('common.next')}
        </button>
      </nav>
    </div>
  )
}

// From md (768px) up: Name | Quantity | Status | Action, shared by the header and every row.
// Status and Action sit side by side; the Action buttons are centred under their header.
// Below md the header is hidden and each row stacks name + status over quantity, with buttons on the right.
const LIST_COLUMNS = 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_104px_84px] md:gap-x-[14px]'

// Units differ between items (kg, boxes, bottles), so Quantity sorts by how full each item is.
const LIST_SORTERS = {
  name: compareNames,
  quantity: (a, b) => getStockRatio(a) - getStockRatio(b) || compareNames(a, b),
  // Ascending is Out of stock → Low → In stock; descending reverses it.
  status: compareStockUrgency,
}

/** First click ascending, second descending, third back to the default urgency order. */
function nextSort(current, key) {
  if (current?.key !== key) return { key, dir: 'asc' }
  return current.dir === 'asc' ? { key, dir: 'desc' } : null
}

function SortHeaderButton({ label, sortKey, sort, onSort, className = '' }) {
  const active = sort?.key === sortKey
  const Arrow = sort?.dir === 'desc' ? ArrowDown : ArrowUp
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <div role="columnheader" aria-sort={ariaSort}>
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, sortKey))}
      className={`inline-flex items-center gap-1 rounded-md text-left uppercase tracking-[0.4px] transition-colors hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/50 dark:hover:text-zinc-200 ${
        active ? 'text-forest-700 dark:text-forest-400' : ''
      } ${className}`}
    >
      {label}
      {active ? <Arrow className="h-3.5 w-3.5" aria-hidden="true" /> : null}
    </button>
    </div>
  )
}

function InventoryListHeader({ sort, onSort }) {
  const { t } = useTranslation()

  return (
    <div role="row" className={`sticky top-0 z-20 hidden items-center border-b border-slate-300/80 bg-slate-50 px-5 py-2 text-[11px] font-medium leading-4 text-slate-500 md:grid dark:border-zinc-700/70 dark:bg-zinc-800 dark:text-zinc-400 ${LIST_COLUMNS}`}>
      <SortHeaderButton label={t('inventory.colName')} sortKey="name" sort={sort} onSort={onSort} />
      <SortHeaderButton label={t('inventory.colQuantity')} sortKey="quantity" sort={sort} onSort={onSort} />
      <SortHeaderButton label={t('common.status')} sortKey="status" sort={sort} onSort={onSort} />
      <span role="columnheader" className="text-center uppercase tracking-[0.4px]">{t('common.action')}</span>
    </div>
  )
}

function InventoryList({ items, onRestock, onHistory, onAdjust, onEdit, onLink, onClearFilters, canManageItems, canAdjustStock, isLoading }) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div role="row" aria-busy="true" className="space-y-2 px-5 py-5">
        <div role="cell" className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-200/70 dark:bg-zinc-700/50" />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div role="row" className="px-6 py-12 text-center">
        <div role="cell" className="flex flex-col items-center gap-3">
          <p className="text-muted text-sm">{t('inventory.noFilterMatches')}</p>
          {onClearFilters ? (
            <button type="button" onClick={onClearFilters} className="btn-secondary min-h-9 px-4 py-2 text-sm">
              {t('inventory.clearFilters')}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <ul role="rowgroup" className="divide-y divide-slate-300/80 dark:divide-zinc-700/70">
      {items.map((item) => {
        const status = getStockStatus(item)
        const actions = [
          { key: 'history', icon: History, label: t('inventory.history'), onSelect: () => onHistory(item) },
          canManageItems && { key: 'edit', icon: Pencil, label: t('inventory.editItem'), onSelect: () => onEdit(item) },
          canAdjustStock && { key: 'adjust', icon: SlidersHorizontal, label: t('inventory.adjustStock'), onSelect: () => onAdjust(item) },
          canManageItems && { key: 'link', icon: Link2, label: t('inventory.linkRecipe'), onSelect: () => onLink(item) },
        ].filter(Boolean)

        return (
          <li key={item.id} role="row" className={`grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-slate-50 md:px-5 dark:hover:bg-zinc-800/40 ${LIST_COLUMNS}`}>
            <div role="cell" className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 md:col-auto md:row-auto">
              <span className="text-heading min-w-0 truncate text-[15px] font-semibold" title={item.item_name}>{item.item_name}</span>
              {item.menu_links?.length ? <span className="shrink-0"><RecipeBadge links={item.menu_links} /></span> : null}
              {/* Small screens: status rides on the name line; md+ gives it its own column. */}
              <span className="shrink-0 md:hidden">
                <StatusBadge className={`transition-colors duration-300 ${statusStyles[status]}`}>
                  {t(STATUS_LABEL_KEYS[status])}
                </StatusBadge>
              </span>
            </div>
            <div role="cell" className="col-start-1 row-start-2 min-w-0 md:col-auto md:row-auto">
              <StockLevel item={item} />
            </div>
            <div role="cell" className="hidden md:block">
              <StatusBadge className={`transition-colors duration-300 ${statusStyles[status]}`}>
                {t(STATUS_LABEL_KEYS[status])}
              </StatusBadge>
            </div>
            <div role="cell" className="col-start-2 row-span-2 row-start-1 flex items-center gap-2 justify-self-end md:col-auto md:row-auto md:row-span-1 md:justify-self-center">
              <button
                type="button"
                onClick={() => onRestock(item)}
                aria-label={`${t('inventory.addStock')}: ${item.item_name}`}
                title={t('inventory.addStock')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-forest-500 text-white shadow-sm transition-colors hover:bg-forest-600 active:bg-forest-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Plus className="h-4 w-4" />
              </button>
              <RowActionsMenu item={item} actions={actions} />
            </div>
          </li>
        )
      })}
    </ul>
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
      <div className="modal-backdrop" aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-restock-title"
        className="modal-panel relative z-10 w-full max-w-md p-6"
      >
        <ModalHeader
          icon={PackagePlus}
          titleId="stock-restock-title"
          title={t('inventory.addStock')}
          subtitle={t('inventory.addStockFor', { item: item.item_name })}
          onClose={onClose}
        />

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
            <FieldLabel icon={Hash} htmlFor="quantity-to-add">
              {t('inventory.receivedQuantity', { units })}
            </FieldLabel>
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
            <button type="submit" className="btn-primary beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)] flex-1 py-2.5 text-sm">{t('inventory.addStock')}</button>
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
      header={<ModalHeader icon={History} titleId="stock-history-title" title={t('inventory.historyFor', { item: item.item_name })} />}
      titleId="stock-history-title"
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
  const { notifySaved, notifyFailed } = useActionBanner()
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
      notifySaved(item.item_name)
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      notifyFailed(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('inventory.adjustStock')}
      header={<ModalHeader icon={SlidersHorizontal} iconClassName="text-amber-600 dark:text-amber-400" titleId="stock-adjust-title" title={t('inventory.adjustStock')} subtitle={item.item_name} />}
      titleId="stock-adjust-title"
      onClose={onClose}
      closeLabel={t('a11y.close')}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="adjust-stock-form" disabled={saving} className={`btn-primary flex-1 py-2.5 text-sm ${saving ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'}`}>
            {t('inventory.saveAdjustment')}
          </button>
        </>
      )}
    >
      <form id="adjust-stock-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <FieldLabel icon={Hash} htmlFor="adjust-count">
            {t('inventory.exactCount', { units: item.unit_label })}
          </FieldLabel>
          <input
            id="adjust-count"
            type="number"
            step={step}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className="input-field"
            required
          />
        </div>
        <div>
          <FieldLabel icon={Layers} htmlFor="adjust-reason">
            {t('inventory.reason')}
          </FieldLabel>
          <IconSelect
            id="adjust-reason"
            value={reason}
            onChange={setReason}
            className="rounded-xl"
            options={[
              { value: 'waste', label: t('inventory.reasonWaste'), icon: Trash2 },
              { value: 'correction', label: t('inventory.reasonCorrection'), icon: Wrench },
            ]}
          />
        </div>
        <div>
          <FieldLabel icon={StickyNote} htmlFor="adjust-note">
            {t('inventory.note')}
          </FieldLabel>
          <input
            id="adjust-note"
            type="text"
            value={note}
            maxLength={255}
            onChange={(event) => setNote(event.target.value)}
            className="input-field"
            required
          />
        </div>
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

const UNIT_ICONS = {
  kg: Scale,
  bags: ShoppingBag,
  bottles: Wine,
  packs: Package,
  boxes: Box,
  eggs: Egg,
  coconuts: Milk,
  cans: CupSoda,
  'tea bags': Tag,
}

function unitsFor(section) {
  return STOCK_UNITS.filter((unit) => unit.section === section)
}

function defaultLowThreshold(max) {
  const num = Number(max)
  if (!Number.isFinite(num) || num < 0) return ''
  return String(Math.round(num * 0.2 * 1000) / 1000)
}

function SearchField({ id, icon, label, placeholder, query, onQuery, options, onSelect, emptyAction }) {
  const [open, setOpen] = useState(false)
  const shown = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div>
      <FieldLabel icon={icon} htmlFor={id}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          onQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        className="input-field w-full"
        autoComplete="off"
      />
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
  const { notifyCreated, notifySaved, notifyFailed } = useActionBanner()
  const editing = mode === 'edit'
  const [name, setName] = useState(editing ? item.item_name : (prefillName || ''))
  const [category, setCategory] = useState(editing ? item.category : '')
  const [section, setSection] = useState(editing ? item.section : 'uncountable')
  const [unit, setUnit] = useState(editing ? item.unit_label : 'kg')
  const [stock, setStock] = useState(editing ? '' : '0')
  const [max, setMax] = useState(editing ? String(item.max_stock) : '')
  const [low, setLow] = useState(editing ? String(item.low_threshold ?? '') : '')
  // critical_threshold is no longer shown (there's no Very low status) but the API still takes it:
  // edits send the stored value back, new items get the old default of 10% of the maximum.
  const storedCritical = editing && item.critical_threshold != null ? Number(item.critical_threshold) : null
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
    if (!thresholdsTouched) setLow(defaultLowThreshold(value))
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
    const numbers = editing ? [max, low] : [stock, max, low]
    if (numbers.some((value) => value === '' || Number(value) < 0 || !Number.isFinite(Number(value)))) {
      setError(t('inventory.numberMin'))
      return
    }
    if (Number(max) < Number(low)) {
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
      // Capped at the maximum, which the API requires.
      critical_threshold: editing
        ? (storedCritical == null ? null : Math.min(storedCritical, Number(max)))
        : Math.round(Number(max) * 0.1 * 1000) / 1000,
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
      if (editing) notifySaved(payload.item_name)
      else notifyCreated(payload.item_name)
      onSaved(data.item)
    } catch (err) {
      setError(err.message)
      notifyFailed(err)
    } finally {
      setSaving(false)
    }
  }

  const existing = suggestion || duplicate

  return (
    <Modal
      title={editing ? t('inventory.editItemFor', { item: item.item_name }) : t('inventory.addItem')}
      header={(
        <ModalHeader
          icon={editing ? Wrench : Plus}
          titleId="stock-item-form-title"
          title={editing ? t('inventory.editItemFor', { item: item.item_name }) : t('inventory.addItem')}
        />
      )}
      titleId="stock-item-form-title"
      onClose={onClose}
      closeLabel={t('a11y.close')}
      stacked={stacked}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary min-w-[8rem] flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="stock-item-form" disabled={saving} className={`btn-primary min-w-[8rem] flex-1 py-2.5 text-sm ${saving ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'}`}>
            {confirmUnit ? t('inventory.changeUnit') : t('inventory.saveItem')}
          </button>
        </>
      )}
    >
      <form id="stock-item-form" onSubmit={handleSubmit} className="space-y-3">
        <div>
          <FieldLabel icon={Package} htmlFor="stock-item-name">{t('inventory.itemName')}</FieldLabel>
          <input id="stock-item-name" value={name} onChange={(event) => setName(event.target.value)} className="input-field w-full" required />
        </div>
        <div>
          <FieldLabel icon={Tag} htmlFor="stock-item-category">{t('common.category')}</FieldLabel>
          <input id="stock-item-category" value={category} onChange={(event) => setCategory(event.target.value)} className="input-field w-full" required />
        </div>
        <div>
          <FieldLabel icon={Layers} htmlFor="stock-item-section">{t('inventory.tableType')}</FieldLabel>
          <IconSelect
            id="stock-item-section"
            value={section}
            onChange={changeSection}
            className="rounded-xl"
            options={[
              { value: 'uncountable', label: t('inventory.kitchenKg'), icon: ChefHat },
              { value: 'countable', label: t('inventory.barUnit'), icon: Utensils },
            ]}
          />
        </div>
        <div>
          <FieldLabel icon={Ruler} htmlFor="stock-item-unit">{t('inventory.unit')}</FieldLabel>
          <IconSelect
            id="stock-item-unit"
            value={unit}
            onChange={setUnit}
            className="rounded-xl"
            options={unitsFor(section).map((entry) => ({ value: entry.id, label: entry.id, icon: UNIT_ICONS[entry.id] }))}
          />
        </div>
        {editing ? null : (
          <div>
            <FieldLabel icon={Hash} htmlFor="stock-item-count">{t('inventory.currentCount')}</FieldLabel>
            <input id="stock-item-count" type="number" min="0" step={section === 'uncountable' ? '0.001' : '1'} value={stock} onChange={(event) => setStock(event.target.value)} className="input-field w-full" required />
          </div>
        )}
        <div>
          <FieldLabel icon={Boxes} htmlFor="stock-item-max">{t('inventory.maximum')}</FieldLabel>
          <input id="stock-item-max" type="number" min="0" step={section === 'uncountable' ? '0.001' : '1'} value={max} onChange={(event) => changeMax(event.target.value)} className="input-field w-full" required />
        </div>
        <div>
          <FieldLabel icon={ArrowDown} htmlFor="stock-item-low">{t('inventory.lowThreshold')}</FieldLabel>
          <input id="stock-item-low" type="number" min="0" step="0.001" value={low} onChange={(event) => { setThresholdsTouched(true); setLow(event.target.value) }} className="input-field w-full" required />
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
  const { notifySaved, notifyDeleted, notifyFailed } = useActionBanner()
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
      notifySaved(t('inventory.linkRecipe'))
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      notifyFailed(err)
    } finally {
      setSaving(false)
    }
  }

  const removeLink = async (linkId) => {
    setError('')
    try {
      const response = await apiFetch(`/inventory/links/${linkId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('inventory.invalidAmount'))
      notifyDeleted(t('inventory.linkRecipe'))
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      notifyFailed(err, 'delete')
    }
  }

  return (
    <Modal
      title={t('inventory.linkRecipe')}
      header={<ModalHeader icon={Link2} titleId="stock-link-title" title={t('inventory.linkRecipe')} />}
      titleId="stock-link-title"
      onClose={onClose}
      closeLabel={t('a11y.close')}
      dismissible={dismissible}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="stock-link-form" disabled={saving} className={`btn-primary flex-1 py-2.5 text-sm ${saving ? '' : 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]'}`}>
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
          id="stock-link-menu"
          icon={Utensils}
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
          id="stock-link-ingredient"
          icon={Package}
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
        <div>
          <FieldLabel icon={Scale} htmlFor="stock-link-per-sale">
            {t('inventory.perSale')}
          </FieldLabel>
          <input
            id="stock-link-per-sale"
            type="number"
            min="0.01"
            step="0.001"
            value={perSale}
            onChange={(event) => setPerSale(event.target.value)}
            className="input-field"
            required
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </Modal>
  )
}

export default function InventoryStock({ view = 'items', onNavigate }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { notifySaved, notifyFailed } = useActionBanner()
  const canManageItems = userHasPermission(user, 'inventory_stock')
  const canAdjustStock = canManageItems
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [usingFallbackInventory, setUsingFallbackInventory] = useState(false)
  // Status tab and category combine (e.g. Low + Dairy); null category = every category.
  const [statusTab, setStatusTab] = useState('all')
  const [category, setCategory] = useState(null)
  const [search, setSearch] = useState('')
  const [restockItem, setRestockItem] = useState(null)
  const [historyItem, setHistoryItem] = useState(null)
  const [adjustItem, setAdjustItem] = useState(null)
  const [linkItem, setLinkItem] = useState(null)
  const [linkPick, setLinkPick] = useState(null)
  const [itemForm, setItemForm] = useState(null)
  // Stocktake and Expenses are sidebar entries; their modals sit over the item list.
  const stocktakeOpen = view === 'stocktake'
  const expenseOpen = view === 'expenses'
  const backToItems = () => onNavigate?.('inventory')

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
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('inventory.invalidAmount'))
      notifySaved(items.find((entry) => entry.id === id)?.item_name)
      fetchInventory()
    } catch (error) {
      console.error("Error submitting stock update:", error)
      notifyFailed(error)
    }
  }

  const { categories, counts: categoryCounts } = useMemo(() => groupCategories(items), [items])

  // Everything except the status tab, so each tab's count follows the chosen category and search.
  const scopedItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      const itemCategory = String(item.category || '').trim()
      if (category && itemCategory !== category) return false
      return (
        !query ||
        String(item.item_name || '').toLowerCase().includes(query) ||
        itemCategory.toLowerCase().includes(query)
      )
    })
  }, [items, category, search])

  const statusCounts = useMemo(() => {
    const counts = { all: scopedItems.length, [STOCK_STATUS.IN]: 0, [STOCK_STATUS.LOW]: 0, [STOCK_STATUS.OUT]: 0 }
    scopedItems.forEach((item) => {
      counts[getStockStatus(item)] += 1
    })
    return counts
  }, [scopedItems])

  const [sort, setSort] = useState(null)

  const filteredItems = useMemo(() => {
    const compare = sort
      ? (a, b) => (sort.dir === 'desc' ? -1 : 1) * LIST_SORTERS[sort.key](a, b)
      : compareStockUrgency
    return scopedItems
      .filter((item) => statusTab === 'all' || getStockStatus(item) === statusTab)
      .sort(compare)
  }, [scopedItems, statusTab, sort])

  const clearFilters = () => {
    setStatusTab('all')
    setCategory(null)
    setSearch('')
  }

  const [page, setPage] = useState(1)
  const [pagedQuery, setPagedQuery] = useState({ statusTab, category, search, sort })
  // A new tab, category, search or sort starts again from page 1.
  if (
    pagedQuery.statusTab !== statusTab ||
    pagedQuery.category !== category ||
    pagedQuery.search !== search ||
    pagedQuery.sort !== sort
  ) {
    setPagedQuery({ statusTab, category, search, sort })
    setPage(1)
  }
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE))
  // Clamp in case a refetch shrank the list below the current page.
  const currentPage = Math.min(page, pageCount)
  const pageItems = filteredItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  return (
    <div className="space-y-6 pt-2">
      {usingFallbackInventory && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t('inventory.offlineData')}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-heading text-lg leading-normal">{t('nav.stockItems')}</h3>
          {canManageItems ? (
            <button
              type="button"
              onClick={() => setItemForm({ mode: 'create' })}
              className="btn-primary beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)] inline-flex min-h-9 items-center gap-1.5 px-4 py-2 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" />
              {t('inventory.addItem')}
            </button>
          ) : null}
        </div>
        <div className="relative max-w-xs flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
          <input
            type="text"
            placeholder={t('inventory.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-10"
          />
        </div>
      </div>

      <section className="table-shell !overflow-visible">
        {/* Status tabs and the category filter sit on the card's top edge; below md the category drops under the tabs. */}
        <div className="flex flex-col gap-2 border-b border-slate-300/80 px-2 pt-1.5 md:flex-row md:items-end md:justify-between md:gap-4 md:px-3 md:pt-1 dark:border-zinc-700/70">
          <StatusTabs active={statusTab} counts={statusCounts} onChange={setStatusTab} panelId="stock-items-panel" />
          <div className="px-2 pb-2.5 md:px-0 md:pb-1">
            <CategoryFilter categories={categories} counts={categoryCounts} value={category} onChange={setCategory} />
          </div>
        </div>
        <div id="stock-items-panel" role="tabpanel" aria-labelledby={`stock-items-panel-tab-${statusTab}`}>
          <div role="table" aria-label={t('nav.stockItems')}>
            <InventoryListHeader sort={sort} onSort={setSort} />
            <InventoryList
              items={pageItems}
              onRestock={setRestockItem}
              onHistory={setHistoryItem}
              onAdjust={setAdjustItem}
              onEdit={(row) => setItemForm({ mode: 'edit', item: row })}
              onLink={setLinkItem}
              onClearFilters={clearFilters}
              canManageItems={canManageItems}
              canAdjustStock={canAdjustStock}
              isLoading={isLoading}
            />
          </div>
        </div>
        {!isLoading && filteredItems.length > 0 ? (
          <ListPagination
            page={currentPage}
            pageCount={pageCount}
            total={filteredItems.length}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      {stocktakeOpen && canManageItems ? (
        <StocktakeModal
          items={items}
          onClose={backToItems}
          onApplied={fetchInventory}
        />
      ) : null}
      {expenseOpen && canManageItems ? (
        <ExpenseLogModal onClose={backToItems} />
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
