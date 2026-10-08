import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'

/**
 * Small centered confirm dialog for destructive actions (delete, sign out): an icon on top,
 * the title and message centered, then Cancel / confirm side by side. `icon` defaults to a
 * trash can; `itemName` names what is affected; `children` adds extra fields (left-aligned).
 */
export default function ConfirmDeleteModal({
  isOpen,
  title,
  message,
  itemName,
  onConfirm,
  onCancel,
  confirmLabel,
  icon: Icon = Trash2,
  children,
}) {
  const { t } = useTranslation()
  const resolvedConfirmLabel = confirmLabel || t('common.delete')
  const panelRef = useModalKeyboard({
    isOpen,
    onEscape: onCancel,
    onPrimaryAction: onConfirm,
    primaryActionMode: 'always',
  })

  if (!isOpen) return null

  // Rendered on <body>: a page's enter animation (transform) would otherwise trap this fixed
  // overlay inside the page, leaving the sidebar and header uncovered.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-white p-6 text-center shadow-2xl outline-none dark:bg-[#151915]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-message"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
          <Icon className="h-7 w-7" aria-hidden />
        </span>
        <h4 id="confirm-delete-title" className="text-heading mt-4 text-lg font-bold">
          {title}
        </h4>
        {itemName ? (
          <p className="text-heading mt-1.5 truncate text-sm font-semibold">{itemName}</p>
        ) : null}
        <p id="confirm-delete-message" className="text-muted mt-1.5 text-sm leading-relaxed">
          {message}
        </p>
        {/* Optional extra fields, e.g. where to move a deleted category's items. */}
        {children ? <div className="text-left">{children}</div> : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-xl bg-gradient-to-b from-red-500 to-red-600 px-4 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(239,68,68,0.35)] transition hover:from-red-600 hover:to-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
