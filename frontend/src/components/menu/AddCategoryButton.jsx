import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, SquarePen, Tag } from 'lucide-react'
import { apiFetch } from '../../services/apiClient'

export const CATEGORY_NAME_MAX = 24

const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ')

/**
 * "Add Category" button with a small popover form. Styled by the caller (`className`) so it
 * matches "Add New Item" exactly. `existing` lists every current category for the duplicate check;
 * `onCreated(name, categories)` runs after the API saves it.
 *
 * Pass `category` (its key) to rename that category instead ("Edit" button, form prefilled with
 * `currentName`, the name it shows); `existing` should then leave it out.
 *
 * Below md the popover spans the nearest positioned ancestor (the button row);
 * from md up it is 250px wide under this button, right edges aligned.
 */
export default function AddCategoryButton({
  existing,
  onCreated,
  category = null,
  currentName = category,
  className = '',
}) {
  const { t } = useTranslation()
  const editing = category != null
  const title = editing ? t('menuAdmin.editCategory') : t('menuAdmin.addCategory')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const panelId = useId()
  const inputId = useId()
  const errorId = useId()

  const close = (restoreFocus = true) => {
    setOpen(false)
    setName('')
    setError('')
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const handlePointer = (event) => {
      if (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return
      // A click elsewhere moves focus there itself, so don't pull it back to the button.
      setOpen(false)
      setName('')
      setError('')
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [open])

  // Esc closes; Tab and Shift+Tab cycle inside the popover while it's open.
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...panelRef.current.querySelectorAll('input, button:not([disabled])')]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const value = cleanName(name)
    if (!value) {
      setError(t('menuAdmin.categoryNameRequired'))
      return
    }
    if (editing && value === currentName) {
      close()
      return
    }
    const taken = ['All', ...existing].some((entry) => entry.toLowerCase() === value.toLowerCase())
    if (taken) {
      setError(t('menuAdmin.categoryExists'))
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch(editing ? `/menu/categories/${encodeURIComponent(category)}` : '/menu/categories', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.code === 'duplicate') setError(t('menuAdmin.categoryExists'))
        else if (data.code === 'required') setError(t('menuAdmin.categoryNameRequired'))
        else if (data.code === 'not_found') setError(t('menuAdmin.categoryNotFound'))
        else setError(data.message || t('menuAdmin.categorySaveFailed'))
        return
      }
      // `data` carries the full category list and labels when the server sends them.
      onCreated(data.category || value, data)
      close()
    } catch {
      // Network failure: the browser's own text ("Failed to fetch") means nothing to staff.
      setError(t('menuAdmin.categorySaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="md:relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) close()
          else {
            setName(currentName ?? '')
            setOpen(true)
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={editing ? title : undefined}
        className={className}
      >
        {editing ? <SquarePen className="h-4 w-4" aria-hidden /> : <Tag className="h-[1.125rem] w-[1.125rem]" aria-hidden />}
        <span>{editing ? t('common.edit') : t('menuAdmin.addCategory')}</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={title}
          onKeyDown={handleKeyDown}
          className="absolute inset-x-0 top-full z-40 mt-2 rounded-2xl border border-border bg-white p-4 shadow-xl ring-1 ring-black/5 md:left-auto md:right-0 md:w-[250px] dark:border-zinc-700/80 dark:bg-zinc-900"
        >
          <form onSubmit={handleSubmit} noValidate>
            <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-zinc-300">
              {t('menuAdmin.categoryName')}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={name}
              maxLength={CATEGORY_NAME_MAX}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError('')
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              className="input-field w-full rounded-xl"
            />
            {/* Fixed height so an error never makes the popover jump. */}
            <p id={errorId} aria-live="polite" className="mt-1 min-h-5 text-xs leading-5 text-red-600 dark:text-red-400">
              {error}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => close()} className="btn-secondary flex-1 px-3 py-2 text-sm">
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                aria-busy={saving || undefined}
                className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t('common.save')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
