import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Search } from 'lucide-react'

const LIST_GAP = 6
const LIST_MAX_HEIGHT = 280

function normalize(text) {
  return String(text || '').trim().toLowerCase()
}

/**
 * Type-to-search field for the item a line bought. Typing filters the ingredients and stock
 * items; Enter or a click picks one. When nothing matches, the last option creates a new
 * ingredient with the typed name. Leaving the field picks the item whose name was typed exactly,
 * or keeps the text as a new ingredient.
 */
export default function ItemCombobox({ id, items, selectedName, onPick, onNew, label, invalid = false }) {
  const { t } = useTranslation()
  const listId = useId()
  const inputRef = useRef(null)
  const [query, setQuery] = useState(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState(null)

  const text = query ?? selectedName ?? ''
  const wanted = normalize(query)
  const matches = wanted ? items.filter((item) => normalize(item.name).includes(wanted)) : items
  const exact = wanted ? items.find((item) => normalize(item.name) === wanted) : null
  const options = [
    ...matches.map((item) => ({ type: 'item', item })),
    ...(wanted && !exact ? [{ type: 'new', name: query.trim() }] : []),
  ]

  const updatePosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - LIST_GAP - 8
    const above = rect.top - LIST_GAP - 8
    const flip = below < 180 && above > below
    setPosition({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(LIST_MAX_HEIGHT, flip ? above : below),
      ...(flip ? { bottom: window.innerHeight - rect.top + LIST_GAP } : { top: rect.bottom + LIST_GAP }),
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return undefined
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  const close = () => {
    setOpen(false)
    setQuery(null)
  }

  const choose = (option) => {
    if (!option) return
    if (option.type === 'item') onPick(option.item)
    else onNew(option.name)
    close()
  }

  // Leaving the field with typed text: an exact name picks that item, anything else is a new ingredient.
  const commitTyped = () => {
    if (query == null) return close()
    if (!wanted) return close()
    if (exact) onPick(exact)
    else onNew(query.trim())
    close()
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      setActive((index) => Math.min(options.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      // Enter picks instead of submitting the expense form.
      if (open && options.length) {
        event.preventDefault()
        choose(options[Math.min(active, options.length - 1)])
      }
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation()
      close()
    }
  }

  const activeOption = open ? options[Math.min(active, options.length - 1)] : null
  const optionId = (index) => `${listId}-${index}`

  return (
    <div className="relative">
      <Search className="text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? optionId(options.indexOf(activeOption)) : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={text}
        placeholder={t('expenses.form.searchItem')}
        onFocus={(event) => {
          event.target.select()
          setActive(0)
          setOpen(true)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onBlur={commitTyped}
        onKeyDown={onKeyDown}
        className="input-field w-full rounded-xl py-2 pl-9 pr-3 text-sm"
      />

      {open && position && options.length
        ? createPortal(
            <ul
              id={listId}
              role="listbox"
              style={{
                position: 'fixed',
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
              }}
              className="icon-select-list z-[130] overflow-y-auto rounded-xl bg-slate-900 p-1.5 text-sm text-white shadow-2xl ring-1 ring-black/5 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {options.map((option, index) => {
                const isActive = index === Math.min(active, options.length - 1)
                const isSelected = option.type === 'item' && option.item.name === selectedName && query == null
                return (
                  <li
                    key={option.type === 'item' ? option.item.id : 'new'}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isActive}
                    // Keep focus in the input so a click is not treated as leaving the field first.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                    className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 ${
                      isActive ? 'bg-white/10 dark:bg-zinc-900/10' : ''
                    } ${option.type === 'new' ? 'font-semibold text-emerald-300 dark:text-forest-700' : 'font-medium'}`}
                  >
                    {option.type === 'new' ? <Plus className="h-4 w-4 shrink-0" aria-hidden /> : null}
                    <span className="min-w-0 flex-1 truncate">
                      {option.type === 'new'
                        ? t('expenses.form.createIngredient', { name: option.name })
                        : option.item.unit ? `${option.item.name} (${option.item.unit})` : option.item.name}
                    </span>
                    {option.type === 'item' ? (
                      <span className="shrink-0 text-2xs text-white/50 dark:text-zinc-500">
                        {t(`expenses.form.itemGroups.${option.item.kind}`)}
                      </span>
                    ) : null}
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-emerald-400 dark:text-forest-600" aria-hidden /> : null}
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
