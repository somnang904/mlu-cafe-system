import { useEffect, useState } from 'react'
import { ChefHat, Coffee, CupSoda, Plus, Trash2, Utensils } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../../services/apiClient'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'
import IconSelect from '../ui/IconSelect'
import ModalHeader from '../ui/ModalHeader'

let nextKey = 1

const SECTIONS = [
  { variant: '', titleKey: 'recipe.sectionBase', hintKey: 'recipe.sectionBaseHint', icon: Utensils },
  { variant: 'hot', titleKey: 'recipe.sectionHot', hintKey: 'recipe.sectionHotHint', icon: Coffee },
  { variant: 'iced', titleKey: 'recipe.sectionIced', hintKey: 'recipe.sectionIcedHint', icon: CupSoda },
]

function toLine(line, variant = '') {
  nextKey += 1
  return {
    key: nextKey,
    ingredientId: line?.ingredient_id ? String(line.ingredient_id) : '',
    quantity: line?.quantity != null ? String(line.quantity) : '',
    variant: line?.variant ?? variant,
    sugar: line?.sugar === true,
  }
}

export default function RecipeModal({ menuItemId, displayName, onClose, onSaved }) {
  const { t } = useTranslation()
  const panelRef = useModalKeyboard({ isOpen: true, onEscape: onClose, primaryActionMode: 'never' })
  const [ingredients, setIngredients] = useState(null)
  const [lines, setLines] = useState(null)
  const [servings, setServings] = useState({ hot: false, iced: false })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([apiFetch(`/menu-recipes/${menuItemId}`), apiFetch('/ingredients')])
      .then(async ([recipeRes, ingredientsRes]) => {
        const recipe = await recipeRes.json().catch(() => ({}))
        const list = await ingredientsRes.json().catch(() => ({}))
        if (!recipeRes.ok) throw new Error(recipe.message || t('recipe.loadFailed'))
        if (!ingredientsRes.ok) throw new Error(list.message || t('recipe.loadFailed'))
        if (cancelled) return
        setIngredients(Array.isArray(list.items) ? list.items : [])
        setServings({ hot: Boolean(recipe.servings?.hot), iced: Boolean(recipe.servings?.iced) })
        setLines((recipe.lines || []).map((line) => toLine(line)))
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || t('recipe.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [menuItemId, t])

  const hasServings = servings.hot || servings.iced
  const unitOf = (ingredientId) => ingredients?.find((entry) => String(entry.id) === String(ingredientId))?.unit_label || ''
  const options = (ingredients || []).map((entry) => ({ value: String(entry.id), label: entry.item_name }))
  const updateLine = (key, patch) => setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const valid =
    Array.isArray(lines) &&
    lines.every((line) => line.ingredientId && Number(line.quantity) > 0) &&
    new Set(lines.map((line) => `${line.ingredientId}:${line.variant}`)).size === lines.length

  const handleSave = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/menu-recipes/${menuItemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          lines: lines.map((line) => ({
            ingredient_id: Number(line.ingredientId),
            quantity: Number(line.quantity),
            variant: line.variant,
            sugar: line.sugar,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || t('recipe.saveFailed'))
      onSaved(data)
    } catch (err) {
      setError(err.message || t('recipe.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-modal-title"
      >
        <div className="modal-panel-body p-6">
          <ModalHeader icon={ChefHat} title={t('recipe.title')} subtitle={displayName} titleId="recipe-modal-title" onClose={onClose} />
          <p className="text-muted mt-3 text-xs leading-relaxed">{t('recipe.hint')}</p>

          {lines === null && !error ? <p className="text-muted mt-5 text-sm">{t('recipe.loading')}</p> : null}

          {lines !== null
            ? SECTIONS.filter(
                (section) =>
                  !section.variant || servings[section.variant] || lines.some((line) => line.variant === section.variant),
              ).map((section) => {
                const SectionIcon = section.icon
                const sectionLines = lines.filter((line) => line.variant === section.variant)
                return (
                  <section key={section.variant || 'base'} className="mt-5 rounded-2xl border border-stone-200 p-4 dark:border-zinc-700">
                    <div className="flex items-start gap-2.5">
                      <SectionIcon className="mt-0.5 h-5 w-5 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-heading text-sm font-semibold">{t(section.titleKey)}</p>
                        <p className="text-muted text-2xs leading-snug">{t(section.hintKey)}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {sectionLines.map((line) => (
                        <div key={line.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                            <IconSelect
                              value={line.ingredientId}
                              options={options}
                              placeholder={t('recipe.chooseIngredient')}
                              onChange={(value) => updateLine(line.key, { ingredientId: value })}
                              className="w-full px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="relative w-28 shrink-0">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                              aria-label={t('recipe.amountPerServing')}
                              placeholder="0"
                              className="input-field w-full py-2 pl-3 pr-10 text-sm tabular-nums"
                            />
                            <span className="text-muted pointer-events-none absolute right-3 top-1/2 max-w-[2.5rem] -translate-y-1/2 truncate text-2xs">
                              {unitOf(line.ingredientId)}
                            </span>
                          </div>
                          {hasServings || line.sugar ? (
                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-2xs font-semibold text-slate-600 ring-1 ring-slate-200 dark:text-zinc-300 dark:ring-zinc-700">
                            <input
                              type="checkbox"
                              checked={line.sugar}
                              onChange={(event) => updateLine(line.key, { sugar: event.target.checked })}
                              className="h-3.5 w-3.5 rounded border-stone-300 text-forest-600 focus:ring-forest-500"
                            />
                            {t('recipe.sugarScaled')}
                          </label>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((entry) => entry.key !== line.key))}
                            aria-label={t('recipe.removeLine')}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setLines((prev) => [...prev, toLine(null, section.variant)])}
                        disabled={!ingredients?.length}
                        className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                        {t('recipe.addLine')}
                      </button>
                    </div>
                  </section>
                )
              })
            : null}

          {lines !== null ? (
            <div className="mt-4 space-y-1">
              <p className="text-muted text-2xs leading-snug">{t('recipe.baseUnitHint')}</p>
              {hasServings ? <p className="text-muted text-2xs leading-snug">{t('recipe.sugarHint')}</p> : null}
              {ingredients && ingredients.length === 0 ? <p className="text-muted text-2xs">{t('recipe.noIngredients')}</p> : null}
            </div>
          ) : null}

          {error ? <p className="mt-4 text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2 text-xs font-semibold">
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!valid || saving}
              className="btn-primary beam-border flex-1 py-2 text-xs font-semibold shadow-[0_4px_14px_rgba(16,185,129,0.35)] disabled:pointer-events-none disabled:opacity-50"
            >
              {saving ? t('recipe.saving') : t('recipe.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
