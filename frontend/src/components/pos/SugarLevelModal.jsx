import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Coffee, Snowflake } from 'lucide-react'
import Modal from '../common/Modal'
import {
  availableServings,
  defaultServing,
  needsTeaFlavor,
  servingPrice,
  TEA_SELECTION_FLAVORS,
} from '../../utils/drinkOptions'
import { DEFAULT_SUGAR_LEVEL, SUGAR_LEVELS, needsSugarLevel } from '../../utils/sugarLevel'
import { translateMenuName } from '../../utils/menuNameTranslations'

export default function SugarLevelModal({ item, presetServing = null, onConfirm, onClose }) {
  const { t, i18n } = useTranslation()
  const servings = availableServings(item)
  const lockedServing = (() => {
    if (!presetServing) return null
    if (servings.some((entry) => entry.id === presetServing)) return presetServing
    // Price-only juice items still use the Ice sugar one-tap flow.
    if (
      presetServing === 'iced' &&
      servings.length === 0 &&
      needsSugarLevel(item, 'iced')
    ) {
      return 'iced'
    }
    return null
  })()
  const [serving, setServing] = useState(lockedServing || defaultServing(item))
  const showSugar = needsSugarLevel(item, serving || lockedServing)
  const [sugarLevel, setSugarLevel] = useState(DEFAULT_SUGAR_LEVEL)
  const [teaFlavor, setTeaFlavor] = useState('')
  const showTeaFlavor = needsTeaFlavor(item)
  // One tap on sugar % adds the drink — no "Add to Order" (Ice coffee + Juice).
  const choosingHotOrIce = servings.length > 1 && !lockedServing
  const quickSugarAdd = showSugar && !showTeaFlavor && !choosingHotOrIce
  // Tea Selection (hot): tap a flavor and it adds immediately — no second confirm.
  const quickTeaFlavorAdd = showTeaFlavor && !showSugar
  const quickAdd = quickSugarAdd || quickTeaFlavorAdd

  useEffect(() => {
    if (!item) return
    const nextServings = availableServings(item)
    let nextLocked = null
    if (presetServing) {
      if (nextServings.some((entry) => entry.id === presetServing)) {
        nextLocked = presetServing
      } else if (
        presetServing === 'iced' &&
        nextServings.length === 0 &&
        needsSugarLevel(item, 'iced')
      ) {
        nextLocked = 'iced'
      }
    }
    setServing(nextLocked || defaultServing(item))
    setSugarLevel(DEFAULT_SUGAR_LEVEL)
    setTeaFlavor('')
  }, [item, presetServing])

  if (!item) return null

  const selectedPrice = servingPrice(item, serving)
  const canSubmit = (servings.length === 0 || Boolean(serving)) && (!showTeaFlavor || teaFlavor)

  const confirmSelection = ({ nextServing = serving, nextSugar = null, nextTeaFlavor = teaFlavor } = {}) => {
    const flavorName = TEA_SELECTION_FLAVORS.find((entry) => entry.id === nextTeaFlavor)?.name || ''
    const resolvedServing = nextServing || lockedServing || null
    onConfirm({
      serving: resolvedServing,
      sugarLevel: nextSugar,
      teaFlavor: flavorName,
      price: servingPrice(item, resolvedServing),
    })
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    confirmSelection({
      nextSugar: showSugar ? sugarLevel : null,
    })
  }

  return (
    <Modal
      titleId="sugar-level-title"
      closeLabel={t('a11y.closeSugarOptions')}
      onClose={onClose}
      maxWidth="max-w-md"
      header={(
        <div className="flex min-w-0 items-start gap-3">
          <Coffee className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
          <div className="min-w-0">
            <h3 id="sugar-level-title" className="text-heading text-lg font-semibold">
              {quickTeaFlavorAdd
                ? t('order.flavor.title')
                : quickSugarAdd
                  ? t('order.sugar.pickSugar')
                  : t('order.sugar.title')}
            </h3>
            <p className="text-heading mt-1 truncate text-sm font-medium">
              {translateMenuName(item.name, i18n.language, t)}
            </p>
            <p className="text-muted mt-1 text-xs">
              {quickTeaFlavorAdd
                ? t('order.sugar.descriptionQuickTea')
                : quickSugarAdd
                  ? t('order.sugar.descriptionQuickIce')
                  : showSugar
                    ? servings.length > 1 && !lockedServing
                      ? t('order.sugar.description')
                      : t('order.sugar.descriptionIcedOnly')
                    : t('order.sugar.descriptionServingOnly')}
            </p>
          </div>
        </div>
      )}
      footer={
        quickAdd ? (
          <button type="button" onClick={onClose} className="btn-secondary w-full text-sm">
            {t('common.cancel')}
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="btn-secondary flex-1 text-sm">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="sugar-level-form"
              disabled={!canSubmit}
              className={`btn-primary flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                canSubmit ? 'beam-border shadow-[0_4px_14px_rgba(16,185,129,0.35)]' : ''
              }`}
            >
              {t('order.sugar.addToOrder')} · ${selectedPrice.toFixed(2)}
            </button>
          </>
        )
      }
    >
      <form id="sugar-level-form" onSubmit={handleSubmit}>
        {servings.length > 1 && !lockedServing ? (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-zinc-300">
              {t('order.serving.title')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {servings.map((option) => {
                const selected = serving === option.id
                const Icon = option.id === 'iced' ? Snowflake : Coffee
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setServing(option.id)}
                    className={
                      selected
                        ? 'min-h-12 rounded-xl bg-forest-500 px-3 py-2 text-left text-sm font-semibold text-white shadow-sm'
                        : 'min-h-12 rounded-xl border border-cocoa-200 bg-white px-3 py-2 text-left text-sm font-medium text-cocoa-800 transition hover:border-forest-400 hover:bg-forest-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-forest-700 dark:hover:bg-forest-950/30'
                    }
                    aria-pressed={selected}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-4 w-4" aria-hidden />
                      {option.id === 'iced' ? t('order.serving.ice') : t(`order.serving.${option.id}`)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {showTeaFlavor ? (
          <div className={servings.length > 1 && !lockedServing ? 'mt-5' : undefined}>
            {!quickTeaFlavorAdd ? (
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-zinc-300">
                {t('order.flavor.title')}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {TEA_SELECTION_FLAVORS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    if (quickTeaFlavorAdd) {
                      confirmSelection({
                        nextServing: serving || 'hot',
                        nextTeaFlavor: option.id,
                      })
                      return
                    }
                    setTeaFlavor(option.id)
                  }}
                  className={
                    !quickTeaFlavorAdd && teaFlavor === option.id
                      ? 'min-h-11 rounded-xl bg-forest-500 px-2 py-2 text-center text-sm font-semibold text-white shadow-sm'
                      : 'min-h-11 rounded-xl border border-cocoa-200 bg-white px-2 py-2 text-center text-sm font-medium text-cocoa-800 transition hover:border-forest-400 hover:bg-forest-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-forest-700 dark:hover:bg-forest-950/30'
                  }
                  aria-pressed={!quickTeaFlavorAdd && teaFlavor === option.id}
                >
                  {t(`order.teaFlavors.${option.id}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showSugar ? (
          <div
            className={
              (servings.length > 1 && !lockedServing) || showTeaFlavor
                ? 'mt-5 grid grid-cols-3 gap-2'
                : 'grid grid-cols-3 gap-2'
            }
          >
            {SUGAR_LEVELS.map((option) => {
              const selected = !quickSugarAdd && sugarLevel === option.value
              const label =
                option.value === '120%' ? t('order.sugar.extraSweet') : option.label
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (quickSugarAdd) {
                      confirmSelection({ nextSugar: option.value })
                      return
                    }
                    setSugarLevel(option.value)
                  }}
                  className={
                    selected
                      ? 'min-h-11 rounded-xl bg-forest-500 px-2 py-2 text-center text-sm font-semibold text-white shadow-sm'
                      : 'min-h-11 rounded-xl border border-cocoa-200 bg-white px-2 py-2 text-center text-sm font-medium text-cocoa-800 transition hover:border-forest-400 hover:bg-forest-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-forest-700 dark:hover:bg-forest-950/30'
                  }
                  aria-pressed={selected}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ) : null}
      </form>
    </Modal>
  )
}
