import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Open panels, oldest first. Only the last (topmost) one reacts to Escape and Tab,
// so a confirm dialog stacked on another modal doesn't close or trap focus for both.
const openPanels = []

export default function Modal({
  title,
  titleId = 'modal-title',
  header,
  onClose,
  closeLabel,
  dismissible = true,
  children,
  footer,
  maxWidth = 'max-w-lg',
  stacked = false,
  headerAlign = 'start',
}) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  // Synced after commit (not during render) so the keydown handler never sees
  // props from a render React discarded.
  useLayoutEffect(() => {
    onCloseRef.current = onClose
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    const panel = panelRef.current
    const previous = document.activeElement
    const main = document.querySelector('main')
    const locked = [document.documentElement, document.body, main].filter(Boolean)
    const previousOverflow = locked.map((node) => node.style.overflow)
    locked.forEach((node) => {
      node.style.overflow = 'hidden'
    })
    panel?.focus({ preventScroll: true })

    const onKeyDown = (event) => {
      if (openPanels[openPanels.length - 1] !== panel) return
      if (event.key === 'Escape') {
        if (!dismissibleRef.current) return
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll('button, input, select, textarea, [href]')]
        .filter((node) => !node.disabled && node.tabIndex !== -1)
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    openPanels.push(panel)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openPanels.splice(openPanels.indexOf(panel), 1)
      document.removeEventListener('keydown', onKeyDown)
      locked.forEach((node, index) => {
        node.style.overflow = previousOverflow[index]
      })
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const requestClose = () => {
    if (!dismissible) return
    onClose?.()
  }

  return createPortal(
    <div className={`fixed inset-0 ${stacked ? 'z-[120]' : 'z-[100]'} flex items-center justify-center p-4 overscroll-contain`}>
      <div className="modal-backdrop fixed inset-0 bg-black/70 backdrop-blur-md" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative z-10 flex min-h-0 max-h-[90vh] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-border bg-white dark:bg-[#151915] shadow-2xl outline-none`}
      >
        <div className={`flex shrink-0 justify-between gap-3 px-6 pt-6 ${header && headerAlign === 'start' ? 'items-start' : 'items-center'}`}>
          {header ? (
            <div className="min-w-0 flex-1">{header}</div>
          ) : (
            <h3 id={titleId} className="text-heading min-w-0 flex-1 break-words text-lg">{title}</h3>
          )}
          <button
            type="button"
            onClick={requestClose}
            disabled={!dismissible}
            className="shrink-0 rounded-lg p-1.5 text-stone-400 hover:bg-olive-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-olive-900/40"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-6">
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap gap-3 px-6 pb-6 pt-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
