import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Receipt,
  Search,
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
import { stockLevelOf } from '../utils/menuStock'
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

function categoryLabel(category, t) {
  const key = CATEGORY_LABEL_KEYS[category]
  return key ? t(key) : category
}

function statusSuffix(status, t) {
  if (!status || status === 'empty') return ''
  const labelKey = TABLE_STATUS_META[status]?.labelKey
  const label = labelKey ? t(labelKey) : status.replace('_', ' ')
  return ` (${label})`
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
  const [activeCategory, setActiveCategory] = useState('All')
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
        String(categoryLabel(item.category, t) || '')
          .toLowerCase()
          .includes(query) ||
        String(item.category || '')
          .toLowerCase()
          .includes(query)
      return matchesCategory && matchesSearch
    })
  }, [menuItems, activeCategory, searchQuery, i18n.language, t])

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
    const outOfStock = linkedStock.find((st) => Number(st.stock) <= 0)
    const lowStock = linkedStock.find((st) => Number(st.stock) > 0 && Number(st.stock) <= 3)

    if (outOfStock) {
      playAlertSound('critical')
      pushBanner({
        title: `${item.name} — ${t('order.outOfStock') || 'Out of stock'}`,
        message: `${outOfStock.name} (0 in stock)`,
        tone: 'error',
        durationMs: 4000,
      })
    } else if (lowStock) {
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

  useEffect(() => {
    if (highlightedId == null) return undefined
    const node = document.getElementById(`menu-item-${highlightedId}`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const timer = window.setTimeout(() => setHighlightedId(null), 1500)
    return () => window.clearTimeout(timer)
  }, [highlightedId, filteredMenuItems])

  const updateQuantity = (id, delta) => {
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
    if (!backendReachable) {
      setSendPaused(true)
      return
    }

    const target = assignmentTargets.find((entry) => String(entry.id) === selectedDestination)
    const destinationId = target?.isTakeOut ? 'takeout' : Number(selectedDestination)
    const success = await assignOrder(destinationId, cart)

    if (!success) {
      setSendPaused(true)
      return
    }

    setSendPaused(false)
    setCart([])
    setSelectedDestination('')
    loadStockLevels()
    openPaymentFor(destinationId)
  }

  const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0)
  const total = subtotal

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

            <div className="flex flex-wrap gap-2">
              {CATEGORY_FILTERS.map(({ id, labelKey }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveCategory(id)}
                  className={`tab-pill rounded-xl shadow-sm ${
                    activeCategory === id ? 'tab-pill-active' : 'tab-pill-inactive'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="order-menu-scroll min-h-0 flex-1 overflow-y-auto p-4 pb-6">
            <div className="grid grid-cols-2 content-start items-stretch gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredMenuItems.map((item, index) => {
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
                      <span className="badge-olive truncate">{categoryLabel(item.category, t)}</span>
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

                    <p className="text-heading mt-3 line-clamp-2 min-w-0 flex-1 text-base font-semibold">
                      {translateMenuName(item.name, i18n.language, t)}
                    </p>

                    {showServingButtons ? (
                      <div className="mt-3">
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
                      <div className="mt-3 flex min-h-10 items-center justify-center rounded-xl border border-forest-200 bg-forest-50 px-2 py-2 text-center text-sm font-bold tabular-nums text-forest-700 shadow-sm transition duration-200 group-hover:border-forest-500 group-hover:bg-forest-500 group-hover:text-white group-hover:shadow-md group-active:scale-[0.98] dark:border-forest-800/60 dark:bg-forest-950/40 dark:text-forest-300 dark:group-hover:bg-forest-600 dark:group-hover:text-white">
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
        </div>

        {/* CURRENT ORDER SIDEBAR PANEL */}
        <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:w-[26rem] lg:shrink-0">
          <div className="shrink-0 border-b border-slate-100 px-5 py-5 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-heading font-semibold">{t('order.currentOrder')}</h3>
                <p className="text-muted text-sm">{t('order.itemLines', { count: cart.length })}</p>
              </div>
              {cart.length > 0 && !sentConfirmation && (
                <button
                  type="button"
                  onClick={clearCart}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                  aria-label={t('a11y.clearCart')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="order-menu-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
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
                  className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 dark:text-zinc-100">
                      {translateMenuName(item.originalName || item.name, i18n.language, t)}
                    </p>
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
                    <p className="mt-0.5 text-sm font-medium text-[#10b981]">
                      {t('order.each', { price: `$${Number(item.price).toFixed(2)}` })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.id, -1)}
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 active:scale-95 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      aria-label={t('a11y.decreaseItem', {
                        item: translateMenuName(item.originalName || item.name, i18n.language, t),
                      })}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-[1.75rem] text-center text-base font-semibold tabular-nums text-slate-900 dark:text-zinc-100">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.id, 1)}
                      className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 active:scale-95 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      aria-label={t('a11y.increaseItem', {
                        item: translateMenuName(item.originalName || item.name, i18n.language, t),
                      })}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {!sentConfirmation && (
            <div className="mt-auto shrink-0 border-t border-slate-100 p-5 dark:border-zinc-800">
              <div className="space-y-2 text-sm select-none">
                <div className="flex justify-between text-slate-500 dark:text-zinc-400">
                  <span>{t('common.subtotal')}</span>
                  <span className="tabular-nums">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 text-lg font-semibold text-slate-900 dark:border-zinc-800 dark:text-zinc-100">
                  <span>{t('common.total')}</span>
                  <span className="tabular-nums text-[#10b981]">${total.toFixed(2)}</span>
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
                <select
                  id="table-destination"
                  value={selectedDestination}
                  onChange={(e) => setSelectedDestination(e.target.value)}
                  className="input-field rounded-xl"
                >
                  <option value="">{t('order.selectDestination')}</option>
                  <optgroup label={t('tables.standardTables')}>
                    {assignmentTargets
                      .filter((table) => !table.isTakeOut && table.section !== 'vip' && !String(table.name).startsWith('VIP'))
                      .map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.name}
                          {statusSuffix(table.status, t)}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label={t('tables.vipRooms')}>
                    {assignmentTargets
                      .filter((table) => table.section === 'vip' || String(table.name).startsWith('VIP'))
                      .map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.name}
                          {statusSuffix(table.status, t)}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label={t('tables.takeOut')}>
                    <option value="takeout">
                      {t('tables.takeOut')}
                      {assignmentTargets.find((entry) => entry.isTakeOut)?.status !== 'empty'
                        ? ` ${t('order.activeTicketSuffix')}`
                        : ''}
                    </option>
                  </optgroup>
                </select>
              </div>

              {!backendReachable || sendPaused ? (
                <p className="mt-4 text-sm text-amber-800 dark:text-amber-200" role="status">
                  {t('connection.orderPaused')}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleSendOrder}
                disabled={cart.length === 0 || !selectedDestination || !backendReachable}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#10b981] py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
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
