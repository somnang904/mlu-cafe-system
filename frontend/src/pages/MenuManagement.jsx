import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Beer,
  CakeSlice,
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
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import ModalHeader from '../components/ui/ModalHeader'
import IconSelect from '../components/ui/IconSelect'
import Tooltip from '../components/ui/Tooltip'
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
}

function categoryLabel(category, t) {
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

  const [form, setForm] = useState(EMPTY_FORM)

  const categories = ['All', ...CATEGORIES]

  const fetchMenu = () => {
    apiFetch('/menu')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server status returned ${res.status}`)
        const data = await res.json()
        return Array.isArray(data) ? data : []
      })
      .then((menu) => {
        if (menu.length === 0) {
          setItems(getMenuFallback())
          setUsingFallbackMenu(true)
          return
        }
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
    })
    setImageMode(item.image_url && !item.image_url.startsWith('/api/uploads') && item.image_url.startsWith('http') ? 'link' : 'upload')
    setUploadError('')
    setLinkDraft('')
    setShowDetailsModal(true)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!form.name) return

    const drink = isDrinkMenuCategory(form.category) || form.use_servings
    if (drink && form.hot_price === '' && form.iced_price === '') {
      alert(t('menuAdmin.errors.servingPrice'))
      return
    }
    if (!drink && !form.price) return

    const payload = {
      name: form.name,
      category: form.category,
      image_url: form.image_url.trim() || null,
    }

    if (drink) {
      payload.hot_price = form.hot_price === '' ? null : parseFloat(form.hot_price)
      payload.iced_price = form.iced_price === '' ? null : parseFloat(form.iced_price)
    } else {
      payload.price = parseFloat(form.price)
    }

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
          alert(data.message || t('menuAdmin.errors.update'))
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
          alert(data.message || t('menuAdmin.errors.save'))
        }
      } catch (error) {
        console.error('Error adding item:', error)
      }
    }
  }

  const handleDeleteItem = async (id) => {
    try {
      const response = await apiFetch(`/menu/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id))
      } else {
        const data = await response.json()
        alert(data.message || t('menuAdmin.errors.delete'))
      }
    } catch (error) {
      console.error('Error deleting item:', error)
    }
  }

  const requestDeleteMenuItem = (item) => {
    setMenuDeleteTarget({
      id: item.id,
      name: translateMenuName(item.name, i18n.language, t),
    })
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
    setForm(EMPTY_FORM)
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
    <div className="space-y-6 page-enter">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
        <h3 className="page-title">{t('nav.menuManagement')}</h3>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
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
          {/* Icon-only on phones so the search box keeps its width; label returns from sm up. */}
          <button
            type="button"
            onClick={openAddModal}
            aria-label={t('menuAdmin.addNewItem')}
            className="btn-primary beam-border inline-flex shrink-0 items-center justify-center gap-2 px-3 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)] sm:px-5"
          >
            <HandPlatter className="h-[1.125rem] w-[1.125rem]" aria-hidden />
            <span className="hidden sm:inline">{t('menuAdmin.addNewItem')}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`tab-pill rounded-xl shadow-sm ${
                activeCategory === category ? 'tab-pill-active' : 'tab-pill-inactive'
              }`}
            >
              {categoryLabel(category, t)}
            </button>
          ))}
        </div>
      </div>

      {usingFallbackMenu && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
          {t('menuAdmin.offlineData')}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((item, index) => (
            <div
              key={item.id}
              className="surface-card flex flex-col items-center p-4 text-center shadow-[0_2px_6px_rgba(40,55,35,0.06),0_8px_24px_rgba(40,55,35,0.10)] transition duration-200 hover:-translate-y-0.5 hover:border-olive-300 hover:shadow-[0_4px_10px_rgba(40,55,35,0.08),0_14px_32px_rgba(40,55,35,0.14)] motion-reduce:hover:translate-y-0 dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] dark:hover:shadow-[0_14px_32px_rgba(0,0,0,0.55)]"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="badge-olive truncate">{categoryLabel(item.category, t)}</span>
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

              {/* flex-1 keeps prices on one baseline when names wrap to two lines */}
              <h4 className="text-heading mt-3 line-clamp-2 flex-1 text-base font-semibold">{translateMenuName(item.name, i18n.language, t)}</h4>
              <p className="mt-1 text-lg font-bold tabular-nums text-forest-600 dark:text-forest-400">
                {formatMenuPrice(item)}
              </p>
            </div>
        ))}
      </div>

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
                  options={CATEGORIES.map((cat) => ({
                    value: cat,
                    label: categoryLabel(cat, t),
                    icon: CATEGORY_ICONS[cat],
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

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={handleCloseDetailsModal} className="btn-secondary flex-1 py-2.5 text-sm">
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-primary beam-border flex-1 py-2.5 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)]">
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
        message={t('menuAdmin.deleteMessage')}
        itemName={menuDeleteTarget?.name}
        onCancel={() => setMenuDeleteTarget(null)}
        onConfirm={confirmDeleteMenuItem}
        confirmLabel={t('common.deleteConfirm')}
      />
    </>
  )
}
