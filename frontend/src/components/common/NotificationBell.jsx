import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import AlertCenter from '../alerts/AlertCenter'
import { useAlerts } from '../../context/AlertsContext'
import { useAuth } from '../../context/AuthContext'

export default function NotificationBell({ onNavigate }) {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const {
    alerts,
    counts,
    badgeCount,
    isLoading,
    error,
    refresh,
    markNotificationRead,
    markAllNotificationsRead,
    lowStockAlertsEnabled,
    loginAlertsEnabled,
  } = useAlerts()
  const hasSecurityAlerts = alerts.some((alert) => alert.category === 'password_reset')
  const hasLoginLockAlerts = alerts.some((alert) => alert.category === 'security_alert')
  const hasReservationAlerts = alerts.some((alert) => alert.category === 'reservation')
  const hasExpenseAlerts = alerts.some((alert) => alert.category === 'expense')
  const hasStockAlerts = alerts.some((alert) => alert.category === 'stock')
  // Badge for actionable notices; bell itself always opens so hosting stays usable.
  const showBadge =
    badgeCount > 0 &&
    (isAdmin ||
      hasSecurityAlerts ||
      hasReservationAlerts ||
      hasExpenseAlerts ||
      hasStockAlerts ||
      lowStockAlertsEnabled ||
      (loginAlertsEnabled && hasLoginLockAlerts))
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const handleClickOutside = (event) => {
      if (
        panelRef.current?.contains(event.target) ||
        buttonRef.current?.contains(event.target)
      ) {
        return
      }
      setIsOpen(false)
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleAction = (alert) => {
    const target =
      alert?.action?.navigateTo ||
      (alert?.category === 'security_alert'
        ? 'security_alerts'
        : alert?.category === 'password_reset'
          ? 'users'
          : alert?.category === 'reservation'
            ? 'reservations'
            : alert?.category === 'expense'
              ? 'reports'
              : 'inventory')
    onNavigate?.(target)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setIsOpen((prev) => !prev)
          if (!isOpen) refresh()
        }}
        aria-label={
          badgeCount
            ? t('a11y.notificationsActive', { count: badgeCount })
            : t('a11y.notifications')
        }
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border/50 bg-card/50 text-foreground backdrop-blur-sm transition-all hover:border-border hover:bg-card active:scale-95 dark:bg-card/40"
      >
        <Bell className="h-5 w-5 text-foreground/90" />
        {showBadge && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-2xs font-bold text-white shadow-lg shadow-red-900/40 ring-2 ring-background">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-2xl border border-border bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 sm:w-[26rem]"
        >
          {alerts.some((alert) => alert.notificationId) ? (
            <div className="flex justify-end border-b border-border/60 px-4 py-2 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => markAllNotificationsRead()}
                className="rounded-full px-3 py-1 text-xs font-semibold text-forest-700 transition hover:bg-forest-50 dark:text-forest-300 dark:hover:bg-forest-950/40"
              >
                {t('alerts.markAllRead')}
              </button>
            </div>
          ) : null}
          <AlertCenter
            alerts={alerts}
            counts={counts}
            isLoading={isLoading}
            error={error}
            onAction={handleAction}
            onDismiss={markNotificationRead}
            onViewAll={() => {
              onNavigate?.(
                hasExpenseAlerts
                  ? 'reports'
                  : hasLoginLockAlerts
                    ? 'security_alerts'
                    : hasSecurityAlerts
                      ? 'users'
                      : hasReservationAlerts
                        ? 'reservations'
                        : 'inventory',
              )
              setIsOpen(false)
            }}
            variant="panel"
            maxItems={8}
          />
        </div>
      )}
    </div>
  )
}
