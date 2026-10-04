import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

const LIST_GAP = 6
const LIST_MAX_HEIGHT = 320

/**
 * Styled replacement for <select> (ARIA "select-only combobox"): focus stays on the
 * trigger and arrow keys move the highlight. The list is portalled to <body> so a
 * scrolling modal cannot clip it, and flips above the trigger when space runs out.
 *
 * options: [{ value, label, icon: LucideIcon }]
 */
export default function IconSelect({ id, value, options, onChange, className = '' }) {
  const listId = useId()
  const triggerRef = useRef(null)
  const listRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState(null)

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]
  const SelectedIcon = selected?.icon

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - LIST_GAP - 8
    const above = rect.top - LIST_GAP - 8
    const flip = below < 200 && above > below
    setPosition({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(LIST_MAX_HEIGHT, flip ? above : below),
      ...(flip ? { bottom: window.innerHeight - rect.top + LIST_GAP } : { top: rect.bottom + LIST_GAP }),
    })
  }, [])

  const openList = () => {
    updatePosition()
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  const choose = (index) => {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return undefined
    updatePosition()
    // Capture phase so scrolling the modal body (not just the window) repositions too.
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const handleKeyDown = (event) => {
    const last = options.length - 1
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => Math.min(last, index + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => Math.max(0, index - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(last)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(activeIndex)
        break
      case 'Escape':
        // Close only the list; stopping here keeps the surrounding modal open.
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`input-field flex cursor-pointer items-center gap-2.5 text-left ${open ? 'border-forest-500 ring-2 ring-forest-500/20' : ''} ${className}`}
      >
        {SelectedIcon ? <SelectedIcon className="h-4 w-4 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden /> : null}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 dark:text-zinc-400 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && position
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-labelledby={id}
              style={{
                position: 'fixed',
                left: position.left,
                width: position.width,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
              }}
              className="icon-select-list z-[70] overflow-y-auto rounded-xl bg-slate-900 p-1.5 text-sm text-white shadow-2xl ring-1 ring-black/5 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {options.map((option, index) => {
                const Icon = option.icon
                const isSelected = index === selectedIndex
                const isActive = index === activeIndex
                return (
                  <li
                    key={option.value}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    // mousedown keeps focus on the trigger, which owns the keyboard handling.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                    className={`flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
                      isActive ? 'bg-white/10 dark:bg-zinc-900/10' : ''
                    } ${isSelected ? 'font-semibold' : 'font-medium'}`}
                  >
                    {Icon ? (
                      <Icon
                        className={`h-4 w-4 shrink-0 ${isSelected ? 'text-emerald-400 dark:text-forest-600' : 'text-white/60 dark:text-zinc-500'}`}
                        aria-hidden
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-emerald-400 dark:text-forest-600" aria-hidden /> : null}
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </>
  )
}
