import { createPortal } from 'react-dom'
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

  // Same centered look as ConfirmDeleteModal, rendered on <body> so the backdrop covers the whole screen.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="modal-backdrop" aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-white p-6 text-center shadow-2xl outline-none dark:bg-[#151915]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="menu-delete-blocked-title"
        aria-describedby="menu-delete-blocked-message"
      >
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
          <Clock3 className="h-7 w-7" aria-hidden />
        </span>
        <h4 id="menu-delete-blocked-title" className="text-heading mt-4 text-lg font-bold">
          {t('menuAdmin.deleteBlockedTitle')}
        </h4>
        <p className="text-heading mt-1.5 truncate text-sm font-semibold">{target.name}</p>
        <p id="menu-delete-blocked-message" className="text-muted mt-1.5 text-sm leading-relaxed">
          {coolingDown
            ? t('menuAdmin.deleteBlockedCooling', { date: unlockDate })
            : t('menuAdmin.deleteBlockedOnSale', { days: 7 })}
        </p>

        <div className={`mt-6 grid gap-3 ${coolingDown ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {t('common.close')}
          </button>
          {!coolingDown ? (
            <button
              type="button"
              onClick={onTurnOff}
              className="min-h-11 rounded-xl bg-gradient-to-b from-forest-500 to-forest-600 px-4 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] transition hover:from-forest-600 hover:to-forest-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500"
            >
              {t('menuAdmin.turnOffNow')}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
