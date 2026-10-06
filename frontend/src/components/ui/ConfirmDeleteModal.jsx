import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'

export default function ConfirmDeleteModal({
  isOpen,
  title,
  message,
  itemName,
  onConfirm,
  onCancel,
  confirmLabel,
}) {
  const { t } = useTranslation()
  const resolvedConfirmLabel = confirmLabel || t('common.deleteConfirm')
  const panelRef = useModalKeyboard({
    isOpen,
    onEscape: onCancel,
    onPrimaryAction: onConfirm,
    primaryActionMode: 'always',
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-message"
      >
        <div className="modal-panel-body p-6">
          <div className="flex gap-4">
            <AlertTriangle className="h-6 w-6 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <h4 id="confirm-delete-title" className="text-heading text-lg font-semibold">
                {title}
              </h4>
              {itemName ? (
                <p className="text-heading mt-2 truncate text-base font-medium">{itemName}</p>
              ) : null}
              <p id="confirm-delete-message" className="text-muted mt-2 text-sm leading-relaxed">
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="modal-panel-footer flex gap-3 px-6 pb-6">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1 text-sm">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 flex-1 rounded-full bg-red-500 text-sm font-medium text-white transition hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
