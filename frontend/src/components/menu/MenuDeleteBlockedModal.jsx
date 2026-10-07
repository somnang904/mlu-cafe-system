import { Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useModalKeyboard } from '../../hooks/useModalKeyboard'

export default function MenuDeleteBlockedModal({ target, onClose, onTurnOff }) {
  const { t, i18n } = useTranslation()
  const isOpen = Boolean(target)
  const panelRef = useModalKeyboard({ isOpen, onEscape: onClose, primaryActionMode: 'never' })

  if (!isOpen) return null

  const coolingDown = target.reason === 'cooling_down'
  const unlockDate = target.availableAt
    ? new Date(target.availableAt).toLocaleDateString(i18n.language === 'km' ? 'km-KH' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : ''

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel relative z-10"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="menu-delete-blocked-title"
        aria-describedby="menu-delete-blocked-message"
      >
        <div className="modal-panel-body p-6">
          <div className="flex gap-4">
            <Clock3 className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <h4 id="menu-delete-blocked-title" className="text-heading text-lg font-semibold">
                {t('menuAdmin.deleteBlockedTitle')}
              </h4>
              <p className="text-heading mt-2 truncate text-base font-medium">{target.name}</p>
              <p id="menu-delete-blocked-message" className="text-muted mt-2 text-sm leading-relaxed">
                {coolingDown
                  ? t('menuAdmin.deleteBlockedCooling', { date: unlockDate })
                  : t('menuAdmin.deleteBlockedOnSale', { days: 7 })}
              </p>
            </div>
          </div>
        </div>

        <div className="modal-panel-footer flex gap-3 px-6 pb-6">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 text-sm">
            {t('common.close')}
          </button>
          {!coolingDown ? (
            <button type="button" onClick={onTurnOff} className="btn-primary flex-1 text-sm">
              {t('menuAdmin.turnOffNow')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
