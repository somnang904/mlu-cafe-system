import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Beer,
  CakeSlice,
  Check,
  CircleDollarSign,
  Coffee,
  CupSoda,
  Drumstick,
  Flame,
  HandPlatter,
  ImageIcon,
  Leaf,
  Link,
  Loader2,
  Plus,
  Salad,
  Sandwich,
  Search,
  Shapes,
  Snowflake,
  Soup,
  SquarePen,
  Tag,
  Trash2,
  Upload,
  UtensilsCrossed,
} from 'lucide-react'
import { apiFetch } from '../services/apiClient'
import { cacheMenuItems, getMenuFallback } from '../utils/offlineFallbacks'
import MenuItemImage from '../components/menu/MenuItemImage'
import AddCategoryButton from '../components/menu/AddCategoryButton'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import MenuDeleteBlockedModal from '../components/menu/MenuDeleteBlockedModal'
import Switch from '../components/ui/Switch'
import ModalHeader from '../components/ui/ModalHeader'
import IconSelect from '../components/ui/IconSelect'
import Tooltip from '../components/ui/Tooltip'
import ScrollRow from '../components/ui/ScrollRow'
import PaginationBar from '../components/ui/PaginationBar'
import { localizeDigits } from '../utils/dateTimeFormat'
import { usePagedGrid } from '../hooks/usePagedGrid'
import TruncatedText from '../components/ui/TruncatedText'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
import { compressImage, MENU_IMAGE_ACCEPT } from '../utils/compressImage'
import { formatMenuPrice, isDrinkMenuCategory } from '../utils/drinkOptions'
import { menuNameMatchesQuery, translateMenuName } from '../utils/menuNameTranslations'

const CATEGORIES = ['Coffee', 'Tea', 'Cold Drinks', 'Beer', 'Starters', 'Mains', 'Soup', 'Vegetable', 'Dessert']

const CATEGORY_KEYS = {
  All: 'all',
  Coffee: 'coffee',
  Tea: 'tea',
  'Cold Drinks': 'coldDrinks',
  Beer: 'beer',
  Starters: 'starters',
  Mains: 'mains',
  Soup: 'soup',
  Vegetable: 'vegetable',
  Dessert: 'dessert',
}

const CATEGORY_ICONS = {
  Coffee,
  Tea: Leaf,
  'Cold Drinks': CupSoda,
  Beer,
  Starters: Sandwich,
  Mains: Drumstick,
  Soup,
  Vegetable: Salad,
  Dessert: CakeSlice,
}

// Form labels carry a small icon, matching the Hot / Iced price labels.
const FIELD_LABEL_CLASS = 'mb-1.5 flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-zinc-300'
const FIELD_ICON_CLASS = 'h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400'

const EMPTY_FORM = {
  name: '',
  category: 'Coffee',
  price: '',
  hot_price: '',
  iced_price: '',
  image_url: '',
  use_servings: false,
  is_available: true,
}

// `labels` holds the names given to renamed built-in categories; they win over the translation.
function categoryLabel(category, t, labels = {}) {
  if (labels[category]) return labels[category]
  const key = CATEGORY_KEYS[category]
  return key ? t(`menuAdmin.categories.${key}`) : category
}

function PriceInput({ id, value, onChange, required = false }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-slate-500 dark:text-zinc-400">
        $
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        required={required}
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="input-field pl-8 tabular-nums"
      />
    </div>
  )
}

export default function MenuManagement() {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState([])
  const [isLoadingMenu, setIsLoadingMenu] = useState(true)
  const [usingFallbackMenu, setUsingFallbackMenu] = useState(false)
  const [imageMode, setImageMode] = useState('upload')
  const [isUploading, setIsUploading] = useState(false)
  const [isCompressing, setIsCompressing] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef(null)
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [menuDeleteTarget, setMenuDeleteTarget] = useState(null)
  const [menuDeleteBlocked, setMenuDeleteBlocked] = useState(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [initialAvailable, setInitialAvailable] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)

  // Built-in categories (minus deleted ones), then ones added from this page (oldest first, so a
  // new one lands at the end). Until the server answers, show the built-in list.
  const [categoryState, setCategoryState] = useState({ categories: CATEGORIES, labels: {} })
  const menuCategories = categoryState.categories
  const categoryLabels = categoryState.labels
  const categories = ['All', ...menuCategories]
  const labelOf = (category) => categoryLabel(category, t, categoryLabels)
  // For the name-clash check: each category's key and the name it shows.
  const namesOf = (list) => [...new Set([...list, ...list.map(labelOf)])]
  const applyCategories = (data) => {
    if (!Array.isArray(data?.categories)) return false
    setCategoryState({ categories: data.categories, labels: data.labels || {} })
    return true
  }

  const [toastMessage, setToastMessage] = useState('')
  const toastTimerRef = useRef(null)
  const showToast = useCallback((message) => {
    setToastMessage(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMessage(''), 3000)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  useEffect(() => {
    let cancelled = false
    apiFetch('/menu/categories')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server status returned ${res.status}`)
        const data = await res.json()
        if (!cancelled) applyCategories(data)
      })
      .catch((err) => console.error('Error loading menu categories:', err))
    return () => {
      cancelled = true
    }
  }, [])

  // A just-added chip sits at the end of the row, often scrolled out of view; bring it in.
  const chipRefs = useRef(new Map())
  const [revealCategory, setRevealCategory] = useState(null)
  useEffect(() => {
    if (!revealCategory) return
    // Scroll only the chip row (scrollIntoView would also move the page).
    const chip = chipRefs.current.get(revealCategory)
    const row = chip?.parentElement
    if (chip && row) {
      const overshoot = chip.getBoundingClientRect().right - row.getBoundingClientRect().right
      if (overshoot > 0) row.scrollBy({ left: overshoot + 16, behavior: 'smooth' })
    }
    setRevealCategory(null)
  }, [revealCategory])

  const handleCategoryCreated = (category, data) => {
    if (!applyCategories(data)) {
      setCategoryState((prev) =>
        prev.categories.includes(category) ? prev : { ...prev, categories: [...prev.categories, category] },
      )
    }
    setActiveCategory(category)
    setRevealCategory(category)
    showToast(t('menuAdmin.categoryAdded'))
  }

  // A built-in category keeps its key (only its label changes); an added one gets a new key.
  const handleCategoryRenamed = (category, data) => {
    const previous = activeCategory
    if (!applyCategories(data)) {
      setCategoryState((prev) => ({
        ...prev,
        categories: prev.categories.map((entry) => (entry === previous ? category : entry)),
      }))
    }
    // The server moved the items too; mirror that so the grid doesn't empty out.
    setItems((prev) => prev.map((item) => (item.category === previous ? { ...item, category } : item)))
    setActiveCategory(category)
    showToast(t('menuAdmin.categoryUpdated'))
  }

  // Any category can be renamed or deleted; deleting one with items moves them to `categoryMoveTo` first.
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState(null)
  const [categoryMoveTo, setCategoryMoveTo] = useState('')
  const deleteItemCount = categoryDeleteTarget
    ? items.filter((item) => item.category === categoryDeleteTarget).length
    : 0
  const moveTargets = menuCategories.filter((entry) => entry !== categoryDeleteTarget)

  const requestDeleteCategory = (category) => {
    setCategoryMoveTo(menuCategories.find((entry) => entry !== category) ?? '')
    setCategoryDeleteTarget(category)
  }

  const confirmDeleteCategory = async () => {
    const category = categoryDeleteTarget
    if (!category) return
    const moveTo = deleteItemCount > 0 ? categoryMoveTo : ''
    setCategoryDeleteTarget(null)
    try {
      const query = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''
      const response = await apiFetch(`/menu/categories/${encodeURIComponent(category)}${query}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.code === 'in_use') {
          // Someone added items since this page loaded; refresh so the dialog offers to move them.
          showToast(t('menuAdmin.categoryInUse', { count: data.count }))
          fetchMenu()
        }
        else if (data.code === 'not_found') showToast(t('menuAdmin.categoryNotFound'))
        else showToast(data.message || t('menuAdmin.categoryDeleteFailed'))
        return
      }
      if (!applyCategories(data)) {
        setCategoryState((prev) => ({ ...prev, categories: prev.categories.filter((entry) => entry !== category) }))
      }
      const moved = Number(data.moved) || 0
      if (moved > 0) {
        // Mirror the server's move and show the items where they went.
        setItems((prev) => prev.map((item) => (item.category === category ? { ...item, category: moveTo } : item)))
        setActiveCategory(moveTo)
        showToast(t('menuAdmin.categoryDeletedMoved', { count: moved, category: labelOf(moveTo) }))
      } else {
        setActiveCategory('All')
        showToast(t('menuAdmin.categoryDeleted'))
      }
    } catch {
      showToast(t('menuAdmin.categoryDeleteFailed'))
    }
  }

  // Outlined like the category chips, so the pair reads as belonging to that row.
  const categoryActionClass =
    'tab-pill tab-pill-inactive inline-flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 shadow-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50 md:w-auto'

  // Same look as "Add New Item"; both buttons size to their label and share one height.
  const headerButtonClass =
    'btn-primary beam-border inline-flex w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap px-5 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)] md:w-auto'

  const fetchMenu = () => {
    apiFetch('/menu')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server status returned ${res.status}`)
        const data = await res.json()
        return Array.isArray(data) ? data : []
      })
      .then((menu) => {
        cacheMenuItems(menu)
        setItems(menu)
        setUsingFallbackMenu(false)
      })
      .catch((err) => {
        console.error('Error pulling menu from database:', err)
        setItems(getMenuFallback())
        setUsingFallbackMenu(true)
      })
      .finally(() => {
        setIsLoadingMenu(false)
      })
  }

  useEffect(() => {
    fetchMenu()
  }, [])

  const filtered = items.filter((item) => {
    const matchesCategory = activeCategory === 'All' || item.category === activeCategory
    const matchesSearch = menuNameMatchesQuery(item.name, search, i18n.language, t)
    return matchesCategory && matchesSearch
  })

  const gridRef = useRef(null)
  const filterKey = `${activeCategory}|${search.trim().toLowerCase()}`
  const { pageItems, currentPage, totalPages, pageSize, goToPage } = usePagedGrid(gridRef, filtered, filterKey)

  const changePage = (page) => {
    goToPage(page)
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleEditClick = (item) => {
    setIsEditing(true)
    setEditingId(item.id)
    setForm({
      name: item.name,
      category: item.category,
      price: item.price != null ? String(item.price) : '',
      hot_price: item.hot_price != null ? String(item.hot_price) : '',
      iced_price: item.iced_price != null ? String(item.iced_price) : '',
      image_url: item.image_url || '',
      use_servings: item.hot_price != null || item.iced_price != null,
      is_available: item.is_available !== false,
    })
    setInitialAvailable(item.is_available !== false)
    setImageMode(item.image_url && !item.image_url.startsWith('/api/uploads') && item.image_url.startsWith('http') ? 'link' : 'upload')
    setUploadError('')
    setLinkDraft('')
    setShowDetailsModal(true)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!form.name || savingRef.current) return

    const drink = isDrinkMenuCategory(form.category) || form.use_servings
    if (drink && form.hot_price === '' && form.iced_price === '') {
      showToast(t('menuAdmin.errors.servingPrice'))
      return
    }
    if (!drink && !form.price) return

    const payload = {
      name: form.name,
      category: form.category,
      image_url: form.image_url.trim() || null,
    }
    if (!isEditing || form.is_available !== initialAvailable) payload.is_available = form.is_available

    if (drink) {
      payload.hot_price = form.hot_price === '' ? null : parseFloat(form.hot_price)
      payload.iced_price = form.iced_price === '' ? null : parseFloat(form.iced_price)
    } else {
      payload.price = parseFloat(form.price)
    }

    savingRef.current = true
    setIsSaving(true)
    try {
    if (isEditing) {
      try {
        const response = await apiFetch(`/menu/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await response.json()

        if (response.ok) {
          fetchMenu()
          handleCloseDetailsModal()
        } else {
          showToast(data.message || t('menuAdmin.errors.update'))
        }
      } catch (error) {
        console.error('Error updating item:', error)
      }
    } else {
      try {
        const response = await apiFetch('/menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await response.json()

        if (response.ok) {
          fetchMenu()
          handleCloseDetailsModal()
        } else {
          showToast(data.message || t('menuAdmin.errors.save'))
        }
      } catch (error) {
        console.error('Error adding item:', error)
      }
    }
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  const handleDeleteItem = async (id) => {
    try {
      const response = await apiFetch(`/menu/${id}`, {
        method: 'DELETE',
      })
      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id))
        if (data.removed_stock_links > 0) {
          showToast(t('menuAdmin.deletedWithStockLinks', { count: data.removed_stock_links }))
        }
      } else if (response.status === 409) {
        fetchMenu()
        showToast(data.message || t('menuAdmin.errors.delete'))
      } else {
        showToast(data.message || t('menuAdmin.errors.delete'))
      }
    } catch (error) {
      console.error('Error deleting item:', error)
    }
  }

  const handleToggleAvailability = async (item, nextValue) => {
    const previous = items
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? { ...entry, is_available: nextValue, unavailable_since: nextValue ? null : new Date().toISOString() }
          : entry,
      ),
    )
    try {
      const response = await apiFetch(`/menu/${item.id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ is_available: nextValue }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('menuAdmin.errors.save'))
      if (data.item) {
        setItems((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, ...data.item } : entry)))
      }
    } catch (error) {
      setItems(previous)
      showToast(error.message || t('menuAdmin.errors.save'))
    }
  }

  const requestDeleteMenuItem = (item) => {
    const name = translateMenuName(item.name, i18n.language, t)
    if (item.can_delete === false) {
      setMenuDeleteBlocked({
        id: item.id,
        name,
        reason: item.delete_block_reason,
        availableAt: item.delete_available_at,
      })
      return
    }
    setMenuDeleteTarget({ id: item.id, name, hasSales: item.has_sales === true })
  }

  const turnOffBlockedItem = async () => {
    const target = menuDeleteBlocked
    setMenuDeleteBlocked(null)
    const item = items.find((entry) => entry.id === target?.id)
    if (item) await handleToggleAvailability(item, false)
  }

  const confirmDeleteMenuItem = async () => {
    if (!menuDeleteTarget) return
    const { id } = menuDeleteTarget
    setMenuDeleteTarget(null)
    await handleDeleteItem(id)
  }

  const handleCloseDetailsModal = useCallback(() => {
    setShowDetailsModal(false)
    setIsEditing(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setImageMode('upload')
    setUploadError('')
    setLinkDraft('')
  }, [])

  const openAddModal = () => {
    setIsEditing(false)
    setEditingId(null)
    // Coffee may have been deleted; then start on the first category that's left.
    setForm({ ...EMPTY_FORM, category: menuCategories.includes(EMPTY_FORM.category) ? EMPTY_FORM.category : (menuCategories[0] ?? '') })
    setImageMode('upload')
    setUploadError('')
    setLinkDraft('')
    setShowDetailsModal(true)
  }

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setIsCompressing(true)
    setUploadError('')

    try {
      let upload = file
      try {
        upload = await compressImage(file)
      } catch (err) {
        // The server compresses too, so an undecodable-in-browser file can still go up as-is.
        console.warn('Client-side image compression skipped:', err)
      } finally {
        setIsCompressing(false)
      }

      const formData = new FormData()
      formData.append('image', upload)

      const response = await apiFetch('/menu/upload-image', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (response.ok && data.imageUrl) {
        setForm((prev) => ({ ...prev, image_url: data.imageUrl }))
      } else {
        setUploadError(data.message || t('menuAdmin.uploadError'))
      }
    } catch (err) {
      console.error('Upload error:', err)
      setUploadError(t('menuAdmin.uploadError'))
    } finally {
      setIsUploading(false)
      if (event.target) event.target.value = ''
    }
  }

  const handleImportLink = async () => {
    const link = linkDraft.trim()
    if (!link || isUploading) return

    // Paths into the app's own public folder (e.g. /menu-images/latte.jpg) are used as-is.
    if (link.startsWith('/')) {
      setForm((prev) => ({ ...prev, image_url: link }))
      setLinkDraft('')
      setUploadError('')
      return
    }

    setIsUploading(true)
    setUploadError('')
    try {
      const response = await apiFetch('/menu/import-image-url', {
        method: 'POST',
        body: JSON.stringify({ url: link }),
      })
      const data = await response.json()
      if (response.ok && data.imageUrl) {
        setForm((prev) => ({ ...prev, image_url: data.imageUrl }))
        setLinkDraft('')
      } else {
        setUploadError(data.message || t('menuAdmin.uploadError'))
      }
    } catch (err) {
      console.error('Image link import error:', err)
      setUploadError(t('menuAdmin.uploadError'))
    } finally {
      setIsUploading(false)
    }
  }

  const detailsPanelRef = useModalKeyboard({
    isOpen: showDetailsModal && !menuDeleteTarget,
    onEscape: handleCloseDetailsModal,
    primaryActionMode: 'auto',
  })

  return (
    <>
    {toastMessage ? (
      <div role="status" className="fixed top-5 right-5 z-[80] flex items-center gap-2 rounded-xl bg-forest-800 px-4 py-3 text-sm font-medium text-white shadow-xl animate-in fade-in slide-in-from-top-3">
        <Check className="h-4 w-4 text-emerald-400" aria-hidden />
        <span>{toastMessage}</span>
      </div>
    ) : null}
    <div className="space-y-6 page-enter">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
        <h3 className="page-title">{t('nav.menuManagement')}</h3>
      </div>

      <div className="flex flex-col gap-3">
        {/* md+: [Search …][Add Category][Add New Item] on one line. Below md the buttons share a row 50/50. */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <form
            className="relative min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault()
            }}
          >
            {/* z-10: the input's backdrop-filter otherwise paints over the icon and washes it out. */}
            <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-500 dark:text-zinc-400" aria-hidden />
            <input
              type="search"
              placeholder={t('menuAdmin.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field rounded-xl pl-11 shadow-sm"
            />
          </form>
          <div className="relative grid grid-cols-2 gap-3 md:flex md:items-center">
            <AddCategoryButton existing={namesOf(menuCategories)} onCreated={handleCategoryCreated} className={headerButtonClass} />
            <button type="button" onClick={openAddModal} className={headerButtonClass}>
              <HandPlatter className="h-[1.125rem] w-[1.125rem]" aria-hidden />
              <span>{t('menuAdmin.addNewItem')}</span>
            </button>
          </div>
        </div>
        {/* md+: [chips …][Edit][Delete] on one line; below md the two buttons sit under the chips 50/50. */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="min-w-0 flex-1">
        <ScrollRow className="-mx-1 -my-1 gap-2 px-1 py-2">
          {categories.map((category) => (
            <button
              key={category}
              ref={(node) => {
                if (node) chipRefs.current.set(category, node)
                else chipRefs.current.delete(category)
              }}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`tab-pill shrink-0 whitespace-nowrap rounded-xl px-3.5 shadow-sm ${
                activeCategory === category ? 'tab-pill-active' : 'tab-pill-inactive'
              }`}
            >
              {labelOf(category)}
            </button>
          ))}
        </ScrollRow>
        </div>
        {activeCategory !== 'All' ? (
          <div className="relative grid grid-cols-2 gap-2 md:flex md:items-center">
            <AddCategoryButton
              key={activeCategory}
              category={activeCategory}
              currentName={labelOf(activeCategory)}
              existing={namesOf(menuCategories.filter((entry) => entry !== activeCategory))}
              onCreated={handleCategoryRenamed}
              className={categoryActionClass}
            />
            <button
              type="button"
              aria-label={t('menuAdmin.deleteCategory')}
              onClick={() => requestDeleteCategory(activeCategory)}
              className={`${categoryActionClass} hover:text-red-600 dark:hover:text-red-400`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              <span>{t('common.delete')}</span>
            </button>
          </div>
        ) : null}
        </div>
      </div>

      {usingFallbackMenu && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t('menuAdmin.offlineData')}
        </div>
      )}

      <div ref={gridRef} className="grid scroll-mt-4 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {pageItems.map((item, index) => (
            <div
              key={item.id}
              className="surface-card flex flex-col items-center p-4 text-center shadow-[0_2px_6px_rgba(40,55,35,0.06),0_8px_24px_rgba(40,55,35,0.10)] transition duration-200 hover:-translate-y-0.5 hover:border-olive-300 hover:shadow-[0_4px_10px_rgba(40,55,35,0.08),0_14px_32px_rgba(40,55,35,0.14)] motion-reduce:hover:translate-y-0 dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] dark:hover:shadow-[0_14px_32px_rgba(0,0,0,0.55)]"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="badge-olive truncate">{labelOf(item.category)}</span>
                <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/90 p-0.5 shadow-sm ring-1 ring-slate-200 dark:bg-zinc-800/90 dark:ring-zinc-700">
                  <Tooltip label={t('common.edit')}>
                    <button
                      type="button"
                      onClick={() => handleEditClick(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-forest-50 hover:text-forest-600 focus-visible:outline-2 focus-visible:outline-forest-500 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300"
                      aria-label={t('menuAdmin.editItemDetails')}
                    >
                      <SquarePen className="h-4 w-4" aria-hidden />
                    </button>
                  </Tooltip>
                  <span className="h-4 w-px bg-slate-200 dark:bg-zinc-700" aria-hidden />
                  <Tooltip label={t('common.delete')}>
                    <button
                      type="button"
                      onClick={() => requestDeleteMenuItem(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                      aria-label={t('menuAdmin.deleteItem')}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <MenuItemImage
                imageUrl={item.image_url}
                alt={translateMenuName(item.name, i18n.language, t)}
                eager={index < 8}
                className="mt-2 h-28 w-28 rounded-2xl border border-slate-100 shadow-sm ring-1 ring-border dark:border-zinc-800"
                fallbackClassName="mt-2 flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-400 ring-1 ring-border dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-500"
                iconClassName="h-10 w-10"
              />

              <TruncatedText
                text={translateMenuName(item.name, i18n.language, t)}
                wrapperClassName="mb-3 mt-3 w-full min-w-0 flex-1 justify-center"
                className="text-heading text-base font-semibold"
              />
              <p className="mt-auto text-lg font-bold tabular-nums text-forest-600 dark:text-forest-400">
                {formatMenuPrice(item)}
              </p>
              <div className="mt-3 flex w-full items-center justify-between gap-3 border-t border-border/60 pt-3">
                <span
                  className={`text-xs font-semibold ${
                    item.is_available === false ? 'text-slate-500 dark:text-zinc-400' : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {item.is_available === false ? t('menuAdmin.offSale') : t('menuAdmin.onSale')}
                </span>
                <Switch
                  checked={item.is_available !== false}
                  onChange={(next) => handleToggleAvailability(item, next)}
                  label={item.is_available === false ? t('menuAdmin.turnOn') : t('menuAdmin.turnOff')}
                />
              </div>
            </div>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted shrink-0 text-xs tabular-nums">
            {t('menuAdmin.showingRange', {
              from: localizeDigits(currentPage * pageSize + 1),
              to: localizeDigits(Math.min((currentPage + 1) * pageSize, filtered.length)),
              total: localizeDigits(filtered.length),
            })}
            {filtered.length !== items.length
              ? ` ${t('menuAdmin.ofTotalItems', { total: localizeDigits(items.length) })}`
              : ''}
          </p>
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={changePage}
            className="sm:min-w-[22rem]"
          />
        </div>
      ) : null}

      {isLoadingMenu && items.length === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="surface-card h-64 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoadingMenu && items.length === 0 && (
        <div className="surface-card border-dashed py-12 text-center">
          <p className="text-muted">{t('menuAdmin.noItemsLoaded')}</p>
        </div>
      )}

      {items.length > 0 && filtered.length === 0 && (
        <div className="surface-card border-dashed py-12 text-center">
          <p className="text-muted">{t('menuAdmin.noMatches')}</p>
        </div>
      )}
    </div>

      {showDetailsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overscroll-contain">
          <div className="modal-backdrop" aria-hidden="true" />
          <div
            ref={detailsPanelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="modal-panel relative z-10 max-h-[90vh] w-full max-w-xl p-6"
          >
            <ModalHeader
              icon={isEditing ? SquarePen : Plus}
              title={isEditing ? t('menuAdmin.modifyItem') : t('menuAdmin.addMenuItem')}
              onClose={handleCloseDetailsModal}
            />

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="item-name" className={FIELD_LABEL_CLASS}>
                  <Tag className={FIELD_ICON_CLASS} aria-hidden />
                  {t('menuAdmin.itemName')}
                </label>
                <input
                  id="item-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('menuAdmin.namePlaceholder')}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="item-category" className={FIELD_LABEL_CLASS}>
                  <Shapes className={FIELD_ICON_CLASS} aria-hidden />
                  {t('common.category')}
                </label>
                <IconSelect
                  id="item-category"
                  value={form.category}
                  onChange={(category) => setForm({ ...form, category })}
                  options={menuCategories.map((cat) => ({
                    value: cat,
                    label: labelOf(cat),
                    icon: CATEGORY_ICONS[cat] ?? Tag,
                  }))}
                />
              </div>

              {!isDrinkMenuCategory(form.category) && (
                <label
                  htmlFor="item-use-servings"
                  className="flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-700 dark:text-zinc-300"
                >
                  <input
                    id="item-use-servings"
                    type="checkbox"
                    checked={form.use_servings}
                    onChange={(e) => setForm({ ...form, use_servings: e.target.checked })}
                    className="h-4 w-4 rounded border-stone-300 accent-forest-500"
                  />
                  {t('menuAdmin.useServings')}
                </label>
              )}

              {isDrinkMenuCategory(form.category) || form.use_servings ? (
                <div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="item-hot-price" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-zinc-300">
                        <Flame className="h-4 w-4 text-orange-500" aria-hidden />
                        {t('menuAdmin.hotPrice')}
                      </label>
                      <PriceInput
                        id="item-hot-price"
                        value={form.hot_price}
                        onChange={(value) => setForm({ ...form, hot_price: value })}
                      />
                    </div>
                    <div>
                      <label htmlFor="item-iced-price" className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-stone-700 dark:text-zinc-300">
                        <Snowflake className="h-4 w-4 text-sky-500" aria-hidden />
                        {t('menuAdmin.icedPrice')}
                      </label>
                      <PriceInput
                        id="item-iced-price"
                        value={form.iced_price}
                        onChange={(value) => setForm({ ...form, iced_price: value })}
                      />
                    </div>
                  </div>
                  <p className="text-muted mt-1.5 text-xs">{t('menuAdmin.servingPriceHelp')}</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="item-price" className={FIELD_LABEL_CLASS}>
                    <CircleDollarSign className={FIELD_ICON_CLASS} aria-hidden />
                    {t('menuAdmin.priceLabel')}
                  </label>
                  <PriceInput
                    id="item-price"
                    required
                    value={form.price}
                    onChange={(value) => setForm({ ...form, price: value })}
                  />
                </div>
              )}

              <div>
                {/* nowrap keeps each button on one line; on very narrow phones the whole toggle drops below the label as one unit. */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-stone-700 dark:text-zinc-300">
                    <ImageIcon className={FIELD_ICON_CLASS} aria-hidden />
                    {t('menuAdmin.imagePath')}
                  </label>
                  <div className="flex shrink-0 whitespace-nowrap rounded-lg bg-stone-100 p-0.5 dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => setImageMode('upload')}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition ${
                        imageMode === 'upload'
                          ? 'bg-white text-forest-700 shadow-sm dark:bg-zinc-700 dark:text-forest-300'
                          : 'text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {t('menuAdmin.imageSourceUpload')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageMode('link')}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition ${
                        imageMode === 'link'
                          ? 'bg-white text-forest-700 shadow-sm dark:bg-zinc-700 dark:text-forest-300'
                          : 'text-stone-500 hover:text-stone-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Link className="h-3.5 w-3.5" />
                      {t('menuAdmin.imageSourceLink')}
                    </button>
                  </div>
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept={MENU_IMAGE_ACCEPT}
                  className="hidden"
                />

                {form.image_url ? (
                  <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-stone-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
                    <MenuItemImage
                      imageUrl={form.image_url}
                      alt={
                        form.name
                          ? t('menuAdmin.namedPreview', { name: form.name })
                          : t('menuAdmin.itemPreview')
                      }
                      className="h-20 w-20 shrink-0 rounded-xl border border-stone-200 object-cover shadow-sm dark:border-zinc-700"
                      fallbackClassName="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-slate-50 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <p className="truncate font-mono text-xs text-stone-600 dark:text-zinc-400">
                        {form.image_url}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (imageMode === 'upload') fileInputRef.current?.click()
                            else setForm({ ...form, image_url: '' })
                          }}
                          disabled={isUploading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        >
                          {isUploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-forest-600" />
                          ) : imageMode === 'upload' ? (
                            <Upload className="h-3.5 w-3.5" />
                          ) : (
                            <Link className="h-3.5 w-3.5" />
                          )}
                          {t('menuAdmin.changePhoto')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, image_url: '' })}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('menuAdmin.removePhoto')}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : isUploading ? (
                  <div className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-forest-500/60 bg-forest-50/30 min-h-[13rem] p-5 text-center dark:bg-forest-950/20">
                    <Loader2 className="h-8 w-8 animate-spin text-forest-500" />
                    <p className="text-sm font-medium text-forest-600 dark:text-forest-400">
                      {isCompressing
                        ? t('menuAdmin.compressingImage')
                        : imageMode === 'link'
                          ? t('menuAdmin.downloadingImage')
                          : t('menuAdmin.uploadingImage')}
                    </p>
                  </div>
                ) : imageMode === 'upload' ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/50 min-h-[13rem] p-5 text-center transition hover:border-forest-500 hover:bg-forest-50/30 dark:border-zinc-700 dark:bg-zinc-800/30 dark:hover:border-forest-500 dark:hover:bg-forest-950/20"
                  >
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-forest-50 text-forest-600 transition group-hover:scale-110 dark:bg-forest-950/60 dark:text-forest-400">
                      <Upload className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-stone-800 dark:text-zinc-200">
                      {t('menuAdmin.chooseImageFile')}
                    </p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400">
                      {t('menuAdmin.chooseImagePrompt')}
                    </p>
                    {/* Visual only (the whole box is the button); mirrors the link box's input row. */}
                    <span className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-stone-300 bg-white px-5 text-sm font-medium text-stone-700 shadow-sm transition group-hover:border-forest-500 group-hover:text-forest-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:group-hover:text-forest-300">
                      <Upload className="h-4 w-4" aria-hidden />
                      {t('menuAdmin.browseFiles')}
                    </span>
                  </button>
                ) : (
                  <div className="group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/50 min-h-[13rem] p-5 text-center transition focus-within:border-forest-500 focus-within:bg-forest-50/30 hover:border-forest-500 dark:border-zinc-700 dark:bg-zinc-800/30 dark:focus-within:border-forest-500 dark:focus-within:bg-forest-950/20 dark:hover:border-forest-500">
                    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-forest-50 text-forest-600 transition group-hover:scale-110 dark:bg-forest-950/60 dark:text-forest-400">
                      <Link className="h-6 w-6" />
                    </div>
                    <label htmlFor="item-image-url" className="text-sm font-semibold text-stone-800 dark:text-zinc-200">
                      {t('menuAdmin.pasteImageLink')}
                    </label>
                    <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400">
                      {t('menuAdmin.pasteImagePrompt')}
                    </p>
                    <div className="mt-3 flex w-full max-w-sm items-center gap-2">
                      <input
                        id="item-image-url"
                        type="text"
                        inputMode="url"
                        value={linkDraft}
                        onChange={(e) => setLinkDraft(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter imports the link instead of submitting the whole item form.
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            handleImportLink()
                          }
                        }}
                        placeholder="https://..."
                        className="input-field min-h-10 min-w-0 flex-1 rounded-xl py-2 text-left shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={handleImportLink}
                        disabled={!linkDraft.trim()}
                        className="btn-primary min-h-10 shrink-0 px-4 text-sm"
                      >
                        {t('menuAdmin.useLink')}
                      </button>
                    </div>
                  </div>
                )}

                {uploadError ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500 dark:text-red-400">{uploadError}</p>
                ) : null}
                <p className="text-muted mt-1.5 text-xs">{t('menuAdmin.imageHelp')}</p>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 px-3 py-2.5 dark:border-zinc-700">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('menuAdmin.availableForSale')}</p>
                  <p className="text-muted mt-0.5 text-2xs leading-snug">
                    {form.is_available ? t('menuAdmin.availableHintOn') : t('menuAdmin.availableHintOff')}
                  </p>
                </div>
                <Switch
                  checked={form.is_available}
                  onChange={(next) => setForm((prev) => ({ ...prev, is_available: next }))}
                  label={t('menuAdmin.availableForSale')}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={handleCloseDetailsModal} className="btn-secondary flex-1 py-2.5 text-sm">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={isSaving} className="btn-primary beam-border flex-1 py-2.5 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)]">
                  {isEditing ? t('common.saveChanges') : t('menuAdmin.addItem')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={Boolean(menuDeleteTarget)}
        title={t('menuAdmin.deleteTitle')}
        message={
          menuDeleteTarget?.hasSales
            ? `${t('menuAdmin.deleteMessage')} ${t('menuAdmin.deleteKeepsSales')}`
            : t('menuAdmin.deleteMessage')
        }
        itemName={menuDeleteTarget?.name}
        onCancel={() => setMenuDeleteTarget(null)}
        onConfirm={confirmDeleteMenuItem}
        confirmLabel={t('common.deleteConfirm')}
      />

      <MenuDeleteBlockedModal
        target={menuDeleteBlocked}
        onClose={() => setMenuDeleteBlocked(null)}
        onTurnOff={turnOffBlockedItem}
      />

      <ConfirmDeleteModal
        isOpen={Boolean(categoryDeleteTarget)}
        title={t('menuAdmin.categoryDeleteTitle')}
        message={
          deleteItemCount > 0
            ? t('menuAdmin.categoryDeleteMoveMessage', { count: deleteItemCount })
            : t('menuAdmin.categoryDeleteMessage')
        }
        itemName={categoryDeleteTarget ? labelOf(categoryDeleteTarget) : ''}
        onCancel={() => setCategoryDeleteTarget(null)}
        onConfirm={confirmDeleteCategory}
        confirmLabel={t('common.deleteConfirm')}
      >
        {deleteItemCount > 0 ? (
          <div className="mt-4">
            <label htmlFor="category-move-to" className={FIELD_LABEL_CLASS}>
              <Tag className={FIELD_ICON_CLASS} aria-hidden />
              {t('menuAdmin.moveItemsTo')}
            </label>
            <IconSelect
              id="category-move-to"
              value={categoryMoveTo}
              onChange={setCategoryMoveTo}
              options={moveTargets.map((entry) => ({
                value: entry,
                label: labelOf(entry),
                icon: CATEGORY_ICONS[entry] ?? Tag,
              }))}
            />
          </div>
        ) : null}
      </ConfirmDeleteModal>
    </>
  )
}
