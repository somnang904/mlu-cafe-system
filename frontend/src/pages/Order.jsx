import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Armchair,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Crown,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react'
import { usePOS } from '../context/POSContext'
import { useConnection } from '../context/ConnectionContext'
import { useNotifications } from '../context/NotificationContext'
import { apiFetch, getAuthToken } from '../services/apiClient'
import { cacheMenuItems, getMenuFallback } from '../utils/offlineFallbacks'
import { TABLE_STATUS_META } from '../data/tables'

import MenuItemImage from '../components/menu/MenuItemImage'
import SugarLevelModal from '../components/pos/SugarLevelModal'
import StockBadge from '../components/pos/StockBadge'
import ScrollRow from '../components/ui/ScrollRow'
import TruncatedText from '../components/ui/TruncatedText'
import Tooltip from '../components/ui/Tooltip'
import IconSelect from '../components/ui/IconSelect'
import { stockLevelOf } from '../utils/menuStock'
import { useScrollFade } from '../hooks/useScrollFade'
import {
  availableServings,
  formatMenuPrice,
  hasServingOptions,
  needsTeaFlavor,
  servingPrice,
} from '../utils/drinkOptions'
import {
  formatDrinkNotes,
  formatItemDisplayName,
  lineIdentity,
  needsSugarLevel,
} from '../utils/sugarLevel'
import {
  menuNameMatchesQuery,
  translateDrinkNotes,
  translateMenuName,
} from '../utils/menuNameTranslations'
import { playAlertSound } from '../utils/soundAlert'

const ROWS_PER_PAGE = 3

const CATEGORY_FILTERS = [
  { id: 'All', labelKey: 'order.categories.all' },
  { id: 'Coffee', labelKey: 'order.categories.coffee' },
  { id: 'Tea', labelKey: 'order.categories.tea' },
  { id: 'Cold Drinks', labelKey: 'order.categories.coldDrinks' },
  { id: 'Beer', labelKey: 'order.categories.beer' },
  { id: 'Starters', labelKey: 'order.categories.starters' },
  { id: 'Mains', labelKey: 'order.categories.mains' },
  { id: 'Soup', labelKey: 'order.categories.soup' },
  { id: 'Vegetable', labelKey: 'order.categories.vegetable' },
  { id: 'Dessert', labelKey: 'order.categories.dessert' },
]

const CATEGORY_LABEL_KEYS = {
  Coffee: 'order.categories.coffee',
  Tea: 'order.categories.tea',
  'Cold Drinks': 'order.categories.coldDrinks',
  Beer: 'order.categories.beer',
  Starters: 'order.categories.starters',
  Mains: 'order.categories.mains',
  Soup: 'order.categories.soup',
  Vegetable: 'order.categories.vegetable',
  Dessert: 'order.categories.dessert',
}

// `labels` holds the names given to renamed built-in categories on the Menu page.
function categoryLabel(category, t, labels = {}) {
  if (labels[category]) return labels[category]
  const key = CATEGORY_LABEL_KEYS[category]
  return key ? t(key) : category
}

function statusLabel(status, t) {
  if (!status || status === 'empty') return ''
  const labelKey = TABLE_STATUS_META[status]?.labelKey
  return labelKey ? t(labelKey) : status.replace('_', ' ')
}

function buildDestinationOptions(targets, t) {
  const isVip = (table) => table.section === 'vip' || String(table.name).startsWith('VIP')
  const toOption = (icon) => (table) => ({
    value: String(table.id),
    label: table.name,
    hint: statusLabel(table.status, t),
    icon,
  })
  const standard = targets.filter((table) => !table.isTakeOut && !isVip(table)).map(toOption(Armchair))
  const vip = targets.filter((table) => !table.isTakeOut && isVip(table)).map(toOption(Crown))
  const takeOutActive = targets.find((entry) => entry.isTakeOut)?.status !== 'empty'

  return [
    ...(standard.length ? [{ header: true, label: t('tables.standardTables') }, ...standard] : []),
    ...(vip.length ? [{ header: true, label: t('tables.vipRooms') }, ...vip] : []),
    { header: true, label: t('tables.takeOut') },
    {
      value: 'takeout',
      label: t('tables.takeOut'),
      hint: takeOutActive ? t('order.activeTicketSuffix') : '',
      icon: ShoppingBag,
    },
  ]
}

export default function Order() {
  const { t, i18n } = useTranslation()
  const { assignmentTargets, assignOrder, orderTargetId, clearOrderTarget, openPaymentFor } = usePOS()
  const { backendReachable } = useConnection()
  const { pushBanner } = useNotifications()
  const [menuItems, setMenuItems] = useState([])
  const [menuReady, setMenuReady] = useState(false)
  const [usingFallbackMenu, setUsingFallbackMenu] = useState(false)
  const [cart, setCart] = useState([])
  const [selectedDestination, setSelectedDestination] = useState('')
  const [sentConfirmation, setSentConfirmation] = useState(null)
  const [sendPaused, setSendPaused] = useState(false)
  const [sendRejection, setSendRejection] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  // From the Menu page: which categories exist (deleted built-ins are left out) and renamed ones' labels.
  const [menuCategories, setMenuCategories] = useState({ categories: null, labels: {} })
  useEffect(() => {
    let cancelled = false
    apiFetch('/menu/categories')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server status returned ${res.status}`)
        const data = await res.json()
        if (!cancelled && Array.isArray(data.categories)) {
          setMenuCategories({ categories: data.categories, labels: data.labels || {} })
        }
      })
      .catch((err) => console.error('Error loading menu categories:', err))
    return () => {
      cancelled = true
    }
  }, [])
  const [searchQuery, setSearchQuery] = useState('')
  const [sugarItem, setSugarItem] = useState(null)
  const [sugarPresetServing, setSugarPresetServing] = useState(null)
  const [highlightedId, setHighlightedId] = useState(null)
  const [stockByMenu, setStockByMenu] = useState({})
  const announceDeepLinkRef = useRef(false)

  const loadStockLevels = useCallback(() => {
    apiFetch('/orders/stock-levels')
      .then(async (res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (!Array.isArray(rows)) return
        const next = {}
        for (const row of rows) {
          const list = next[row.menu_item_id] || []
          list.push({
            name: row.item_name,
            stock: Number(row.stock_quantity),
            status: row.stock_status || null,
          })
          next[row.menu_item_id] = list
        }
        setStockByMenu(next)
      })
      .catch(() => {})

    apiFetch('/menu')
      .then(async (res) => (res.ok ? res.json() : null))
      .then((items) => {
        if (!Array.isArray(items)) return
        const byId = new Map(items.map((item) => [Number(item.id), item]))
        setMenuItems((prev) =>
          prev.map((item) => {
            const fresh = byId.get(Number(item.id))
            return fresh ? { ...item, stock_left: fresh.stock_left, stock_status: fresh.stock_status } : item
          }),
        )
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadStockLevels()
    const interval = window.setInterval(loadStockLevels, 30000)
    window.addEventListener('focus', loadStockLevels)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', loadStockLevels)
    }
  }, [loadStockLevels])

  useEffect(() => {
    const token = getAuthToken()
    if (!token) {
      setMenuReady(true)
      return undefined
    }

    let cancelled = false
    apiFetch('/menu', { token })
      .then(async (res) => {
        if (cancelled || res.status === 401) return []
        if (!res.ok) throw new Error(`Server status returned ${res.status}`)
        const data = await res.json()
        return Array.isArray(data) ? data : []
      })
      .then((items) => {
        if (cancelled) return
        if (items.length === 0) {
          setMenuItems(getMenuFallback())
          setUsingFallbackMenu(true)
          setMenuReady(true)
          return
        }
        cacheMenuItems(items)
        setMenuItems(items)
        setUsingFallbackMenu(false)
        setMenuReady(true)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Error pulling menu for ordering page:', err)
        setMenuItems(getMenuFallback())
        setUsingFallbackMenu(true)
        setMenuReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (orderTargetId == null || orderTargetId === '') return undefined
    setSelectedDestination(String(orderTargetId))
    clearOrderTarget()
    return undefined
  }, [orderTargetId, clearOrderTarget])

  const menuImageById = useMemo(() => new Map(menuItems.map((item) => [Number(item.id), item.image_url])), [menuItems])

  // Categories added on the Menu page get a chip after the built-in ones, once an item uses them.
  const categoryFilters = useMemo(() => {
    const { categories, labels } = menuCategories
    const builtIns = CATEGORY_FILTERS.filter(({ id }) => id === 'All' || !categories || categories.includes(id)).map(
      (filter) => (labels[filter.id] ? { id: filter.id, label: labels[filter.id] } : filter),
    )
    const known = new Set(builtIns.map(({ id }) => id))
    const added = []
    menuItems.forEach((item) => {
      const category = String(item.category || '').trim()
      if (category && !known.has(category)) {
        known.add(category)
        added.push({ id: category, label: category })
      }
    })
    return [...builtIns, ...added]
  }, [menuItems, menuCategories])

  const filteredMenuItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return menuItems.filter((item) => {
      const available = !(item.is_available === false || item.is_available === 0)
      if (!available) return false
      const matchesCategory =
        activeCategory === 'All' ||
        String(item.category || '').toLowerCase() === activeCategory.toLowerCase()
      const matchesSearch =
        !query ||
        menuNameMatchesQuery(item.name, query, i18n.language, t) ||
        String(categoryLabel(item.category, t, menuCategories.labels) || '')
          .toLowerCase()
          .includes(query) ||
        String(item.category || '')
          .toLowerCase()
          .includes(query)
      return matchesCategory && matchesSearch
    })
  }, [menuItems, activeCategory, searchQuery, i18n.language, t, menuCategories.labels])

  function stockLeftFor(menuItemId) {
    const linked = stockByMenu[menuItemId] || []
    if (!linked.length) return Infinity
    return Math.min(...linked.map((st) => Number(st.stock)))
  }

  function hasStockFor(menuItemId, extra) {
    const left = stockLeftFor(menuItemId)
    if (left === Infinity) return true
    const inCart = cart
      .filter((line) => Number(line.menu_item_id) === Number(menuItemId))
      .reduce((sum, line) => sum + Number(line.quantity || 0), 0)
    return inCart + extra <= left
  }

  function warnNoStock(name, menuItemId) {
    const left = Math.max(0, stockLeftFor(menuItemId))
    playAlertSound('critical')
    pushBanner({
      title: `${name} — ${left > 0 ? t('order.notEnoughStock') : t('order.outOfStock')}`,
      message: t('order.stockLeft', { count: left }),
      tone: 'error',
      durationMs: 4000,
    })
  }

  const addToCart = (item, options = {}) => {
    const notes = options.notes != null ? String(options.notes) : item.notes || ''
    const originalName = item.originalName || item.name
    const menuItemId = item.menu_item_id ?? item.id
    const price = Number(options.price ?? item.price ?? 0)
    const lineItem = {
      ...item,
      originalName,
      name: formatItemDisplayName(originalName, notes),
      notes,
      sugarLevel: options.sugarLevel || item.sugarLevel || null,
      serving: options.serving || item.serving || null,
      price,
      unitPrice: price,
      menu_item_id: menuItemId,
      id: lineIdentity({ menu_item_id: menuItemId, notes }),
      quantity: 1,
    }

    setSentConfirmation(null)

    const linkedStock = stockByMenu[menuItemId] || []
    const lowStock = linkedStock.find((st) => Number(st.stock) > 0 && st.status === 'LOW_STOCK')

    if (!hasStockFor(menuItemId, 1)) {
      warnNoStock(item.name, menuItemId)
      return
    }
    if (lowStock) {
      playAlertSound('warning')
      pushBanner({
        title: `${item.name} — ${t('order.lowStock') || 'Low stock'}`,
        message: `${lowStock.name} (${lowStock.stock} remaining)`,
        tone: 'warning',
        durationMs: 3500,
      })
    }

    setCart((prev) => {
      const existing = prev.find((cartItem) => lineIdentity(cartItem) === lineItem.id)
      if (existing) {
        return prev.map((cartItem) =>
          lineIdentity(cartItem) === lineItem.id
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem,
        )
      }
      return [...prev, lineItem]
    })
  }

  const announceAdded = (item) => {
    pushBanner({
      title: t('order.addedFromPick', {
        name: translateMenuName(item.originalName || item.name, i18n.language, t),
      }),
      tone: 'success',
      durationMs: 2500,
    })
  }

  const handleMenuItemClick = (item, announce = false) => {
    const servings = availableServings(item)
    const hotServing = servings.find((entry) => entry.id === 'hot')
    const icedServing = servings.find((entry) => entry.id === 'iced')
    const drinkWithChoice = Boolean(hotServing) && Boolean(icedServing)

    // Dual Hot/Ice cards use the buttons — ignore plain card taps (deep-link still opens options).
    if (!announce && drinkWithChoice) {
      return
    }

    // Hot-only drinks: add directly (Tea Selection still needs flavor).
    if (
      servings.length === 1 &&
      servings[0].id === 'hot' &&
      !needsTeaFlavor(item)
    ) {
      addToCart(item, {
        serving: 'hot',
        price: servings[0].price,
        notes: formatDrinkNotes({ serving: 'hot' }),
      })
      if (announce) announceAdded(item)
      return
    }

    // Ice-only drinks: open sugar picker.
    if (
      servings.length === 1 &&
      servings[0].id === 'iced' &&
      !needsTeaFlavor(item)
    ) {
      announceDeepLinkRef.current = announce
      setSugarPresetServing('iced')
      setSugarItem(item)
      return
    }

    if (needsSugarLevel(item) || hasServingOptions(item) || needsTeaFlavor(item)) {
      announceDeepLinkRef.current = announce
      // Juice / milk drinks: open sugar picker in one-tap mode (same as Ice coffee).
      const oneTapSugar =
        needsSugarLevel(item) && !needsTeaFlavor(item) && !drinkWithChoice
      setSugarPresetServing(oneTapSugar ? 'iced' : null)
      setSugarItem(item)
      return
    }
    addToCart(item)
    if (announce) announceAdded(item)
  }

  const handleHotServing = (item) => {
    if (needsTeaFlavor(item)) {
      setSugarPresetServing('hot')
      setSugarItem(item)
      return
    }
    const price = servingPrice(item, 'hot')
    addToCart(item, {
      serving: 'hot',
      price,
      notes: formatDrinkNotes({ serving: 'hot' }),
    })
  }

  const handleColdServing = (item) => {
    // Cold → sugar picker (and tea flavor if needed); sugar tap adds immediately when possible.
    setSugarPresetServing('iced')
    setSugarItem(item)
  }

  const handleSugarConfirm = ({ serving, sugarLevel, teaFlavor, price }) => {
    if (!sugarItem) return
    const shouldAnnounce = announceDeepLinkRef.current
    announceDeepLinkRef.current = false
    addToCart(sugarItem, {
      serving,
      sugarLevel,
      price,
      notes: formatDrinkNotes({ serving, sugarLevel, teaFlavor }),
    })
    if (shouldAnnounce) announceAdded(sugarItem)
    setSugarItem(null)
    setSugarPresetServing(null)
  }

  const applyMenuItemRef = useRef(handleMenuItemClick)
  // Synced after commit so the deep-link timer below calls the latest handler.
  useLayoutEffect(() => {
    applyMenuItemRef.current = handleMenuItemClick
  })

  useEffect(() => {
    if (!menuReady) return undefined
    const raw = new URLSearchParams(window.location.search).get('item')
    if (raw == null || raw === '') return undefined

    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const url = new URL(window.location.href)
      url.searchParams.delete('item')
      const search = url.searchParams.toString()
      window.history.replaceState(
        null,
        '',
        `${url.pathname}${search ? `?${search}` : ''}${url.hash}`,
      )

      const id = /^\d+$/.test(raw) ? Number(raw) : NaN
      const item = menuItems.find((entry) => Number(entry.id) === id)
      const unavailable = !item || item.is_available === false || item.is_available === 0
      if (unavailable) {
        pushBanner({
          title: t('order.pickUnavailable'),
          tone: 'error',
          durationMs: 2500,
        })
        return
      }

      setActiveCategory('All')
      setSearchQuery('')
      setHighlightedId(item.id)
      applyMenuItemRef.current(item, true)
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [menuReady, menuItems, pushBanner, t])

  const menuAreaRef = useRef(null)
  const menuScroll = useScrollFade(menuAreaRef, 48)
  const cartListRef = useRef(null)
  const cartScroll = useScrollFade(cartListRef, 32)
  const hasMenuCards = filteredMenuItems.length > 0
  const menuGridRef = useRef(null)
  const [pageSize, setPageSize] = useState(3 * ROWS_PER_PAGE)
  const filterKey = `${activeCategory}|${searchQuery.trim().toLowerCase()}`
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 })
  const totalPages = Math.max(1, Math.ceil(filteredMenuItems.length / pageSize))
  const highlightIndex =
    highlightedId == null ? -1 : filteredMenuItems.findIndex((item) => Number(item.id) === Number(highlightedId))
  const requestedPage =
    highlightIndex >= 0 ? Math.floor(highlightIndex / pageSize) : pageState.key === filterKey ? pageState.page : 0
  const currentPage = Math.min(requestedPage, totalPages - 1)
  const pagedMenuItems = filteredMenuItems.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
  const goToPage = (page) => setPageState({ key: filterKey, page: Math.max(0, Math.min(page, totalPages - 1)) })

  useLayoutEffect(() => {
    const area = menuAreaRef.current
    const grid = menuGridRef.current
    if (!area || !grid) return undefined

    const measure = () => {
      const columns = window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
      const next = columns * ROWS_PER_PAGE
      setPageSize((prev) => (prev === next ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [menuReady, hasMenuCards])

  useEffect(() => {
    menuAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentPage, filterKey])

  useEffect(() => {
    if (highlightedId == null) return undefined
    const node = document.getElementById(`menu-item-${highlightedId}`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const landingPage = highlightIndex >= 0 ? Math.floor(highlightIndex / pageSize) : null
    const timer = window.setTimeout(() => {
      if (landingPage != null) setPageState({ key: filterKey, page: landingPage })
      setHighlightedId(null)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [highlightedId, highlightIndex, pageSize, filterKey])

  const updateQuantity = (id, delta) => {
    if (delta > 0) {
      const line = cart.find((item) => item.id === id)
      if (line && !hasStockFor(line.menu_item_id, delta)) {
        warnNoStock(line.name, line.menu_item_id)
        return
      }
    }
    setSentConfirmation(null)
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === id ? { ...item, quantity: item.quantity + delta } : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }

  const clearCart = () => {
    setCart([])
    setSentConfirmation(null)
  }

  const handleSendOrder = async () => {
    if (!selectedDestination || cart.length === 0) return
    setSendRejection('')
    if (!backendReachable) {
      setSendPaused(true)
      return
    }

    const target = assignmentTargets.find((entry) => String(entry.id) === selectedDestination)
    const destinationId = target?.isTakeOut ? 'takeout' : Number(selectedDestination)
    const outcome = await assignOrder(destinationId, cart)

    if (!outcome.ok) {
      setSendRejection(outcome.message || '')
      setSendPaused(!outcome.message)
      return
    }

    setSendPaused(false)
    setSendRejection('')
    setCart([])
    setSelectedDestination('')
    loadStockLevels()
    openPaymentFor(destinationId)
  }

  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0)
  const total = subtotal

  const destinationOptions = useMemo(() => buildDestinationOptions(assignmentTargets, t), [assignmentTargets, t])

  const destinationLabel =
    assignmentTargets.find((entry) => String(entry.id) === selectedDestination)?.name ?? null

  return (
    <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col overflow-hidden page-enter">
      <div className="mb-3 shrink-0">
        <h3 className="page-title">{t('nav.order')}</h3>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
        {/* ITEMS SELECTION GRID */}
        <div className="surface-panel flex min-h-0 flex-1 flex-col overflow-hidden shadow-sm">
          <div className="shrink-0 space-y-4 border-b border-slate-100 px-5 py-5 dark:border-zinc-800">
            <div>
              <h3 className="text-heading font-semibold">{t('order.selectItems')}</h3>
            </div>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-500 dark:text-zinc-400"
                aria-hidden
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('order.searchMenu')}
                className="input-field rounded-xl pl-11 shadow-sm"
              />
            </div>

            <ScrollRow className="-mx-1 -my-1 gap-2 px-1 py-2">
              {categoryFilters.map(({ id, labelKey, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveCategory(id)}
                  className={`tab-pill shrink-0 whitespace-nowrap rounded-xl px-3.5 shadow-sm ${
                    activeCategory === id ? 'tab-pill-active' : 'tab-pill-inactive'
                  }`}
                >
                  {labelKey ? t(labelKey) : label}
                </button>
              ))}
            </ScrollRow>
          </div>

          <div
            ref={menuAreaRef}
            onScroll={menuScroll.onScroll}
            style={menuScroll.style}
            className="order-menu-scroll min-h-0 flex-1 overflow-y-auto p-4"
          >
            <div
              ref={menuGridRef}
              className="grid grid-cols-2 content-start items-stretch gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3"
            >
              {pagedMenuItems.map((item, index) => {
                const servings = availableServings(item)
                const hotServing = servings.find((entry) => entry.id === 'hot')
                const icedServing = servings.find((entry) => entry.id === 'iced')
                // Hot/Ice whenever the item has both prices (Coffee, Tea, Matcha, etc.).
                const showServingButtons = Boolean(hotServing) && Boolean(icedServing)
                const isHighlighted = Number(highlightedId) === Number(item.id)
                const stockLevel = stockLevelOf(item)

                return (
                  <div
                    key={item.id}
                    id={`menu-item-${item.id}`}
                    data-menu-card
                    className={`surface-card group relative flex h-full min-w-0 w-full flex-col items-center p-3 text-center shadow-[0_2px_6px_rgba(40,55,35,0.06),0_8px_24px_rgba(40,55,35,0.10)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_10px_rgba(40,55,35,0.08),0_14px_32px_rgba(40,55,35,0.14)] motion-reduce:hover:translate-y-0 dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] dark:hover:shadow-[0_14px_32px_rgba(0,0,0,0.55)] sm:p-4 ${
                      isHighlighted ? 'border-forest-500 ring-2 ring-forest-400/70' : 'hover:border-olive-300'
                    } ${stockLevel === 'out' ? 'opacity-70' : ''} ${showServingButtons ? '' : 'cursor-pointer'}`}
                    onClick={
                      showServingButtons ? undefined : () => handleMenuItemClick(item)
                    }
                    onKeyDown={
                      showServingButtons
                        ? undefined
                        : (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleMenuItemClick(item)
                            }
                          }
                    }
                    role={showServingButtons ? undefined : 'button'}
                    tabIndex={showServingButtons ? undefined : 0}
                  >
                    <div className="flex w-full items-center justify-between gap-1.5">
                      <span className="badge-olive truncate">{categoryLabel(item.category, t, menuCategories.labels)}</span>
                      <StockBadge level={stockLevel} left={item.stock_left} />
                    </div>

                    <MenuItemImage
                      imageUrl={item.image_url}
                      alt={translateMenuName(item.name, i18n.language, t)}
                      eager={index < 9}
                      className="mt-2 h-20 w-20 rounded-2xl border border-slate-100 shadow-sm ring-1 ring-border dark:border-zinc-800 sm:h-24 sm:w-24"
                      fallbackClassName="mt-2 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-400 ring-1 ring-border dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-500 sm:h-24 sm:w-24"
                      iconClassName="h-8 w-8"
                    />

                    <TruncatedText
                      text={translateMenuName(item.name, i18n.language, t)}
                      wrapperClassName="mb-3 mt-3 w-full min-w-0 justify-center"
                      className="text-heading text-base font-semibold"
                    />

                    {showServingButtons ? (
                      <div className="mt-auto w-full">
                        <div
                          className={`grid min-w-0 gap-1.5 ${
                            hotServing && icedServing ? 'grid-cols-2' : 'grid-cols-1'
                          }`}
                          role="group"
                          aria-label={t('order.serving.title')}
                        >
                          {hotServing ? (
                            <button
                              type="button"
                              onClick={() => handleHotServing(item)}
                              className="min-h-10 min-w-0 whitespace-nowrap rounded-xl bg-forest-500 px-1.5 py-2 text-center text-xs font-semibold text-white shadow-sm transition hover:bg-forest-600 active:scale-[0.98] dark:bg-forest-600 dark:hover:bg-forest-500 sm:px-2 sm:text-sm"
                            >
                              {t('order.serving.hot')}
                              {` $${hotServing.price.toFixed(2)}`}
                            </button>
                          ) : null}
                          {icedServing ? (
                            <button
                              type="button"
                              onClick={() => handleColdServing(item)}
                              className="min-h-10 min-w-0 whitespace-nowrap rounded-xl border border-cocoa-200 bg-cocoa-50 px-1.5 py-2 text-center text-xs font-semibold text-cocoa-800 transition hover:bg-cocoa-100 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 sm:px-2 sm:text-sm"
                            >
                              {t('order.serving.ice')}
                              {` $${icedServing.price.toFixed(2)}`}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-auto flex min-h-10 w-full items-center justify-center rounded-xl border border-forest-200 bg-forest-50 px-2 py-2 text-center text-sm font-bold tabular-nums text-forest-700 shadow-sm transition duration-200 group-hover:border-forest-500 group-hover:bg-forest-500 group-hover:text-white group-hover:shadow-md group-active:scale-[0.98] dark:border-forest-800/60 dark:bg-forest-950/40 dark:text-forest-300 dark:group-hover:bg-forest-600 dark:group-hover:text-white">
                        {formatMenuPrice(item)}
                      </div>
                    )}
                  </div>
                )
              })}

              {usingFallbackMenu && menuItems.length > 0 && (
                <div className="col-span-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
                  {t('order.offlineMenu')}
                </div>
              )}

              {menuItems.length === 0 && (
                <div className="col-span-full py-12 text-center text-sm text-slate-400 dark:text-zinc-500">
                  {t('order.noItemsLoaded')}
                </div>
              )}

              {menuItems.length > 0 && filteredMenuItems.length === 0 && (
                <div className="col-span-full py-12 text-center text-sm text-slate-400 dark:text-zinc-500">
                  {t('order.noFilteredItems')}
                </div>
              )}
            </div>
          </div>

          {totalPages > 1 ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
                className="btn-secondary inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm shadow-sm disabled:pointer-events-none disabled:opacity-40 sm:px-4"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t('common.previous')}</span>
              </button>

              <div
                className="flex items-center gap-1.5"
                role="group"
                aria-label={t('order.pageOf', { page: currentPage + 1, total: totalPages })}
              >
                {Array.from({ length: totalPages }, (_, page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => goToPage(page)}
                    aria-current={page === currentPage ? 'page' : undefined}
                    aria-label={t('order.pageOf', { page: page + 1, total: totalPages })}
                    className={`h-2.5 rounded-full transition-all ${
                      page === currentPage
                        ? 'w-6 bg-forest-500'
                        : 'w-2.5 bg-slate-300 hover:bg-slate-400 dark:bg-zinc-700 dark:hover:bg-zinc-600'
                    }`}
                  />
                ))}
                <span className="ml-2 text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
                  {currentPage + 1} / {totalPages}
                </span>
              </div>

              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
                className="btn-primary inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm shadow-sm disabled:pointer-events-none disabled:opacity-40 sm:px-4"
              >
                <span className="hidden sm:inline">{t('common.next')}</span>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>

        {/* CURRENT ORDER SIDEBAR PANEL */}
        <div className="surface-panel flex min-h-0 w-full flex-col overflow-hidden shadow-sm lg:w-[26rem] lg:shrink-0">
          <div className="shrink-0 border-b border-slate-200/80 px-5 py-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-500 text-white shadow-sm">
                  <ShoppingBag className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-heading text-base font-semibold">{t('order.currentOrder')}</h3>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">
                    {t('order.itemLines', { count: cart.length })}
                  </p>
                </div>
              </div>
              {cart.length > 0 && !sentConfirmation && (
                <Tooltip label={t('a11y.clearCart')} side="left">
                  <button
                    type="button"
                    onClick={clearCart}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-600 hover:ring-red-200 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    aria-label={t('a11y.clearCart')}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          <div
            ref={cartListRef}
            onScroll={cartScroll.onScroll}
            style={cartScroll.style}
            className="order-menu-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
          >
            {sentConfirmation ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-8 w-8 text-[#10b981]" />
                </div>
                <p className="text-heading mt-4 text-lg font-semibold">
                  {t('order.sentTo', { destination: sentConfirmation })}
                </p>
                <p className="text-muted mt-1 text-sm">{t('order.addedToBill')}</p>
              </div>
            ) : cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-400 dark:text-zinc-500">
                <Receipt className="mb-3 h-10 w-10 opacity-40" />
                <p className="text-sm">{t('order.emptyCart')}</p>
                <p className="mt-1 text-xs">{t('order.emptyCartHint')}</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(40,55,35,0.08)] dark:border-zinc-700 dark:bg-zinc-800/70"
                >
                  <MenuItemImage
                    imageUrl={menuImageById.get(Number(item.menu_item_id ?? item.id))}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-xl border border-slate-100 dark:border-zinc-700"
                    fallbackClassName="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-zinc-700 dark:text-zinc-500"
                    iconClassName="h-5 w-5"
                  />
                  <div className="min-w-0 flex-1">
                    <TruncatedText
                      text={translateMenuName(item.originalName || item.name, i18n.language, t)}
                      wrapperClassName="w-full min-w-0"
                      className="text-sm font-semibold text-slate-900 dark:text-zinc-100"
                    />
                    {item.notes ? (
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
                        {translateDrinkNotes(item.notes, t)}
                      </p>
                    ) : null}
                    {(() => {
                      const names = (stockByMenu[item.menu_item_id] || [])
                        .filter((row) => row.stock <= 0)
                        .map((row) => row.name)
                      if (!names.length) return null
                      return (
                        <p className="mt-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                          {t('order.outOfStockNamed', { names: names.join(', ') })}
                        </p>
                      )
                    })()}
                    <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-500 dark:text-zinc-400">
                      {t('order.each', { price: `$${Number(item.price).toFixed(2)}` })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-sm font-bold tabular-nums text-forest-600 dark:text-forest-400">
                      ${(Number(item.price) * Number(item.quantity)).toFixed(2)}
                    </span>
                    <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, -1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 transition hover:bg-white hover:shadow-sm active:scale-95 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        aria-label={t('a11y.decreaseItem', {
                          item: translateMenuName(item.originalName || item.name, i18n.language, t),
                        })}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-[2rem] text-center text-sm font-bold tabular-nums text-slate-900 dark:text-zinc-100">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.id, 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-forest-500 text-white shadow-sm transition hover:bg-forest-600 active:scale-95"
                        aria-label={t('a11y.increaseItem', {
                          item: translateMenuName(item.originalName || item.name, i18n.language, t),
                        })}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {!sentConfirmation && (
            <div className="mt-auto shrink-0 border-t border-slate-200/80 p-5 dark:border-zinc-800">
              <div className="space-y-2 select-none rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/70 dark:bg-zinc-800/60 dark:ring-zinc-700">
                <div className="flex justify-between text-sm text-slate-600 dark:text-zinc-400">
                  <span>{t('common.subtotal')}</span>
                  <span className="tabular-nums">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between border-t border-dashed border-slate-300 pt-2 dark:border-zinc-600">
                  <span className="text-base font-semibold text-slate-900 dark:text-zinc-100">{t('common.total')}</span>
                  <span className="text-2xl font-bold tabular-nums text-forest-600 dark:text-forest-400">
                    ${total.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="table-destination"
                  className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-zinc-300"
                >
                  <UtensilsCrossed className="h-4 w-4 text-[#10b981]" />
                  {t('order.tableAssignment')}
                </label>
                <IconSelect
                  id="table-destination"
                  value={selectedDestination}
                  onChange={setSelectedDestination}
                  placeholder={t('order.selectDestination')}
                  options={destinationOptions}
                  className="rounded-xl"
                />
              </div>

              {!backendReachable || sendPaused ? (
                <p className="mt-4 text-sm text-amber-800 dark:text-amber-200" role="status">
                  {t('connection.orderPaused')}
                </p>
              ) : sendRejection ? (
                <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
                  {sendRejection}
                </p>
              ) : null}
              {cart.length > 0 && !selectedDestination ? (
                <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                  {t('order.chooseDestinationHint')}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleSendOrder}
                disabled={cart.length === 0 || !selectedDestination || !backendReachable}
                className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed ${
                  cart.length === 0 || !selectedDestination || !backendReachable
                    ? 'bg-slate-200 text-slate-500 dark:bg-zinc-800 dark:text-zinc-500'
                    : 'beam-border bg-forest-500 text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] hover:bg-forest-600'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                {destinationLabel
                  ? t('order.payFor', { destination: destinationLabel })
                  : t('order.payment')}
              </button>
            </div>
          )}
        </div>
      </div>

      <SugarLevelModal
        item={sugarItem}
        presetServing={sugarPresetServing}
        onConfirm={handleSugarConfirm}
        onClose={() => {
          announceDeepLinkRef.current = false
          setSugarItem(null)
          setSugarPresetServing(null)
        }}
      />
    </div>
  )
}
