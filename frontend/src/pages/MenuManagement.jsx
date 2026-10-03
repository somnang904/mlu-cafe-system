import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus, Search, Trash2, X, Upload, Link, Loader2 } from 'lucide-react'
import { apiFetch } from '../services/apiClient'
import { cacheMenuItems, getMenuFallback } from '../utils/offlineFallbacks'
import MenuItemImage from '../components/menu/MenuItemImage'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import { useModalKeyboard } from '../hooks/useModalKeyboard'
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

export default function MenuManagement() {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState([])
  const [isLoadingMenu, setIsLoadingMenu] = useState(true)
  const [usingFallbackMenu, setUsingFallbackMenu] = useState(false)
  const [imageMode, setImageMode] = useState('upload')
  const [isUploading, setIsUploading] = useState(false)
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
  }, [])

  const openAddModal = () => {
    setIsEditing(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setImageMode('upload')
    setUploadError('')
    setShowDetailsModal(true)
  }

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    setUploadError('')

    try {
      const formData = new FormData()
      formData.append('image', file)

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

  const detailsPanelRef = useModalKeyboard({
    isOpen: showDetailsModal && !menuDeleteTarget,
    onEscape: handleCloseDetailsModal,
    primaryActionMode: 'auto',
  })

  return (
    <>
    <div className="space-y-6 page-enter">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="page-title">{t('nav.menuManagement')}</h3>
        </div>
        <button
          type="button"
          onClick={openAddModal}
          className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm"
        >
          <Plus className="h-4 w-4" />
          {t('menuAdmin.addNewItem')}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault()
          }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            placeholder={t('menuAdmin.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-10"
          />
        </form>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`tab-pill ${
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
              className="surface-card flex flex-col p-5 transition-colors hover:border-olive-300"
            >
              <div className="flex items-start justify-between gap-2">
                <MenuItemImage
                  imageUrl={item.image_url}
                  alt={translateMenuName(item.name, i18n.language, t)}
                  eager={index < 8}
                  className="h-14 w-14 shrink-0 rounded-2xl border border-slate-100 object-cover ring-1 ring-border dark:border-zinc-800"
                />
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <span className="badge-olive mr-1">{categoryLabel(item.category, t)}</span>
                  <button
                    type="button"
                    onClick={() => handleEditClick(item)}
                    className="rounded-full p-2 text-olive-400 transition hover:bg-olive-50 hover:text-forest-600 dark:hover:bg-olive-900/40 dark:hover:text-forest-300"
                    title={t('menuAdmin.editItemDetails')}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDeleteMenuItem(item)}
                    className="rounded-lg p-2 text-stone-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    title={t('menuAdmin.deleteItem')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <h4 className="text-heading mt-4 text-lg">{translateMenuName(item.name, i18n.language, t)}</h4>
              <p className="mt-1 text-2xl font-bold text-forest-600 dark:text-forest-400">
                {formatMenuPrice(item)}
              </p>
            </div>
        ))}
      </div>

      {isLoadingMenu && items.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="surface-card h-40 animate-pulse" />
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
          <button
            type="button"
            aria-label={t('a11y.closeModal')}
            className="modal-backdrop"
            onClick={handleCloseDetailsModal}
          />
          <div
            ref={detailsPanelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="modal-panel relative z-10 max-h-[90vh] w-full max-w-lg p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-heading text-lg">
                {isEditing ? t('menuAdmin.modifyItem') : t('menuAdmin.addMenuItem')}
              </h3>
              <button
                type="button"
                onClick={handleCloseDetailsModal}
                className="rounded-lg p-1.5 text-stone-400 hover:bg-olive-100 dark:hover:bg-olive-900/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="item-name" className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
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
                <label htmlFor="item-category" className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                  {t('common.category')}
                </label>
                <select
                  id="item-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="input-field"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {categoryLabel(cat, t)}
                    </option>
                  ))}
                </select>
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
                      <label htmlFor="item-hot-price" className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                        {t('menuAdmin.hotPrice')}
                      </label>
                      <input
                        id="item-hot-price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.hot_price}
                        onChange={(e) => setForm({ ...form, hot_price: e.target.value })}
                        placeholder={t('menuAdmin.priceNotSold')}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label htmlFor="item-iced-price" className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                        {t('menuAdmin.icedPrice')}
                      </label>
                      <input
                        id="item-iced-price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.iced_price}
                        onChange={(e) => setForm({ ...form, iced_price: e.target.value })}
                        placeholder={t('menuAdmin.priceNotSold')}
                        className="input-field"
                      />
                    </div>
                  </div>
                  <p className="text-muted mt-1.5 text-xs">{t('menuAdmin.servingPriceHelp')}</p>
                </div>
              ) : (
                <div>
                  <label htmlFor="item-price" className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
                    {t('menuAdmin.priceLabel')}
                  </label>
                  <input
                    id="item-price"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="0.00"
                    className="input-field"
                  />
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-stone-700 dark:text-zinc-300">
                    {t('menuAdmin.imagePath')}
                  </label>
                  <div className="flex rounded-lg bg-stone-100 p-0.5 dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => setImageMode('upload')}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
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
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
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

                {imageMode === 'upload' ? (
                  <div className="space-y-3">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="image/png,image/jpeg,image/webp,image/gif"
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
                        <div className="flex flex-1 flex-col gap-2 min-w-0">
                          <p className="truncate text-xs font-mono text-stone-600 dark:text-zinc-400">
                            {form.image_url}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isUploading}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                            >
                              {isUploading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-forest-600" />
                              ) : (
                                <Upload className="h-3.5 w-3.5" />
                              )}
                              {t('menuAdmin.changePhoto')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, image_url: '' })}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('menuAdmin.removePhoto')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="group flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/50 p-6 text-center transition hover:border-forest-500 hover:bg-forest-50/30 dark:border-zinc-700 dark:bg-zinc-800/30 dark:hover:border-forest-500 dark:hover:bg-forest-950/20"
                      >
                        {isUploading ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 animate-spin text-forest-500" />
                            <p className="text-sm font-medium text-forest-600 dark:text-forest-400">
                              {t('menuAdmin.uploadingImage')}
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-forest-50 text-forest-600 transition group-hover:scale-110 dark:bg-forest-950/60 dark:text-forest-400">
                              <Upload className="h-6 w-6" />
                            </div>
                            <p className="text-sm font-semibold text-stone-800 dark:text-zinc-200">
                              {t('menuAdmin.chooseImageFile')}
                            </p>
                            <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400">
                              {t('menuAdmin.chooseImagePrompt')}
                            </p>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-start gap-4">
                      <input
                        id="item-image-url"
                        type="text"
                        value={form.image_url}
                        onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                        placeholder={t('menuAdmin.imagePathPlaceholder')}
                        className="input-field min-w-0 flex-1"
                      />
                      <MenuItemImage
                        imageUrl={form.image_url}
                        alt={
                          form.name
                            ? t('menuAdmin.namedPreview', { name: form.name })
                            : t('menuAdmin.itemPreview')
                        }
                        className="h-20 w-20 shrink-0 rounded-xl border border-slate-100 object-cover dark:border-zinc-800"
                        fallbackClassName="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-slate-50 dark:border-zinc-800 dark:bg-zinc-800"
                      />
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
                <button type="submit" className="btn-primary flex-1 py-2.5 text-sm">
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
