import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Copy,
  KeyRound,
  Package,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const SEVERITY_STYLES = {
  critical: {
    labelKey: 'statuses.critical',
    badge: 'bg-red-100 text-red-800 ring-red-200 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-800/60',
    border: 'border-l-red-500',
    iconBg: 'bg-red-500/15 text-red-600 dark:text-red-300',
    Icon: AlertTriangle,
  },
  warning: {
    labelKey: 'statuses.warning',
    badge: 'bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50',
    border: 'border-l-amber-400',
    iconBg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    Icon: AlertTriangle,
  },
  password_reset: {
    labelKey: 'statuses.security',
    badge: 'bg-violet-100 text-violet-900 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-200 dark:ring-violet-800/60',
    border: 'border-l-violet-500',
    iconBg: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    Icon: KeyRound,
  },
  expense: {
    labelKey: 'alerts.category.expense',
    badge: 'bg-orange-100 text-orange-900 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:ring-orange-800/50',
    border: 'border-l-orange-500',
    iconBg: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    Icon: Wallet,
  },
  info: {
    labelKey: 'statuses.reminder',
    badge:
      'bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800/50',
    border: 'border-l-sky-500',
    iconBg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    Icon: CalendarClock,
  },
  reservation: {
    labelKey: 'alerts.category.reservation',
    badge:
      'bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800/50',
    border: 'border-l-violet-500',
    iconBg: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    Icon: CalendarClock,
  },
}

const CATEGORY_ICONS = {
  stock: Package,
  password_reset: KeyRound,
  reservation: CalendarClock,
  security_alert: ShieldAlert,
  expense: Wallet,
}

function categoryLabel(t, category) {
  if (category === 'password_reset') return t('alerts.category.security')
  if (category === 'security_alert') return t('alerts.category.loginSecurity')
  if (category === 'reservation') return t('alerts.category.reservation')
  if (category === 'expense') return t('alerts.category.expense')
  return category
}

function alertBadgeSeverity(alert) {
  if (alert.category === 'password_reset') return 'password_reset'
  if (alert.category === 'reservation') return 'reservation'
  if (alert.category === 'expense') return 'expense'
  return alert.severity
}

function formatAlertTime(timestamp, language) {
  if (!timestamp) return ''
  try {
    const locale = language === 'km' ? 'km-KH' : 'en-US'
    return new Date(timestamp).toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return timestamp
  }
}

export function AlertSeverityBadge({ severity }) {
  const { t } = useTranslation()
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.warning
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${style.badge}`}
    >
      {t(style.labelKey)}
    </span>
  )
}

export function AlertCard({ alert, onAction, onDismiss, compact = false }) {
  const { t, i18n } = useTranslation()
  const severity = SEVERITY_STYLES[alert.category] || SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.warning
  const SeverityIcon = severity.Icon
  const CategoryIcon = CATEGORY_ICONS[alert.category] || Bell
  const temporaryPassword = alert.meta?.temporaryPassword
  const [copied, setCopied] = useState(false)

  const copyPassword = async () => {
    if (!temporaryPassword) return
    try {
      await navigator.clipboard.writeText(temporaryPassword)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <article
      className={`border-l-4 ${severity.border} bg-white px-3 py-3 transition-colors hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50 ${
        compact ? '' : 'rounded-xl border border-slate-200 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${severity.iconBg}`}
        >
          <SeverityIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <AlertSeverityBadge severity={alertBadgeSeverity(alert)} />
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CategoryIcon className="h-3 w-3" />
              {categoryLabel(t, alert.category)}
            </span>
          </div>
          <h4 className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{alert.title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.message}</p>
          {alert.category === 'expense' && (alert.meta?.actorName || alert.meta?.amount != null) ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {alert.meta.actorName ? (
                <div>
                  <dt className="text-muted-foreground">{t('alerts.staff')}</dt>
                  <dd className="font-medium text-foreground">{alert.meta.actorName}</dd>
                </div>
              ) : null}
              {alert.meta.actorRole ? (
                <div>
                  <dt className="text-muted-foreground">{t('alerts.role')}</dt>
                  <dd className="font-medium text-foreground">{alert.meta.actorRole}</dd>
                </div>
              ) : null}
              {alert.meta.amount != null ? (
                <div>
                  <dt className="text-muted-foreground">{t('alerts.amount')}</dt>
                  <dd className="font-medium text-foreground">
                    ${Number(alert.meta.amount).toFixed(2)}
                  </dd>
                </div>
              ) : null}
              {alert.meta.description || alert.meta.category ? (
                <div>
                  <dt className="text-muted-foreground">{t('alerts.purpose')}</dt>
                  <dd className="font-medium text-foreground">
                    {alert.meta.description || alert.meta.category}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {alert.category === 'password_reset' && (alert.meta?.displayName || alert.meta?.username) ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div>
                <dt className="text-muted-foreground">{t('alerts.staff')}</dt>
                <dd className="font-medium text-foreground">{alert.meta.displayName || alert.meta.username}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('alerts.username')}</dt>
                <dd className="font-medium text-foreground">{alert.meta.username}</dd>
              </div>
              {alert.meta.role ? (
                <div>
                  <dt className="text-muted-foreground">{t('alerts.role')}</dt>
                  <dd className="font-medium text-foreground">{alert.meta.role}</dd>
                </div>
              ) : null}
              {alert.meta.email ? (
                <div>
                  <dt className="text-muted-foreground">{t('alerts.email')}</dt>
                  <dd className="font-medium text-foreground">{alert.meta.email}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {temporaryPassword ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 dark:border-violet-800/60 dark:bg-violet-950/40">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-violet-900 dark:text-violet-100">
                {temporaryPassword}
              </code>
              <button
                type="button"
                onClick={copyPassword}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 dark:text-violet-200 dark:hover:bg-violet-900/50"
              >
                <Copy className="h-3 w-3" />
                {copied ? t('alerts.copied') : t('alerts.copy')}
              </button>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground/80">{formatAlertTime(alert.timestamp, i18n.language)}</p>
            <div className="flex items-center gap-2">
              {alert.notificationId && onDismiss ? (
                <button
                  type="button"
                  onClick={() => onDismiss(alert)}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  {t('alerts.markHandled')}
                </button>
              ) : null}
              {alert.action?.label && (
                <button
                  type="button"
                  onClick={() => onAction?.(alert)}
                  className="rounded-lg bg-forest-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-forest-500 dark:bg-forest-500 dark:hover:bg-forest-400"
                >
                  {alert.action.label}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * Reusable alert list / dashboard widget.
 * variant: 'panel' (dropdown) | 'widget' (dashboard card)
 */
export default function AlertCenter({
  alerts = [],
  counts,
  isLoading = false,
  error = null,
  onAction,
  onDismiss,
  onViewAll,
  variant = 'panel',
  maxItems,
}) {
  const { t } = useTranslation()
  const sortedAlerts = useMemo(() => {
    return [...(alerts || [])].sort((a, b) => {
      const timeA = new Date(a.timestamp || a.created_at || 0).getTime()
      const timeB = new Date(b.timestamp || b.created_at || 0).getTime()
      if (timeB !== timeA) return timeB - timeA
      const rank = (s) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2)
      return rank(a.severity) - rank(b.severity)
    })
  }, [alerts])
  const visibleAlerts = maxItems ? sortedAlerts.slice(0, maxItems) : sortedAlerts
  const total = counts?.total ?? alerts.length
  const isWidget = variant === 'widget'

  return (
    <div
      className={
        isWidget
          ? 'surface-card overflow-hidden'
          : 'flex max-h-[28rem] flex-col'
      }
    >
      <div
        className={`flex items-start justify-between gap-3 border-b border-border/40 ${
          isWidget ? 'px-5 py-4' : 'px-4 py-3'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-forest-600 dark:text-forest-400" />
            <p className="text-heading text-sm font-semibold">
              {isWidget ? t('alerts.centerTitle') : t('alerts.title')}
            </p>
          </div>
          <p className="text-muted mt-0.5 text-xs">
            {isLoading
              ? t('alerts.scanning')
              : error
                ? t('alerts.unavailable')
                : total === 0
                  ? t('alerts.noneActive')
                  : t('alerts.summary', {
                      total,
                      critical: counts?.critical || 0,
                      warning: counts?.warning || 0,
                    })}
          </p>
        </div>
        {isWidget && total > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(counts?.critical || 0) > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800 dark:bg-red-950/50 dark:text-red-200">
                {t('alerts.criticalCount', { count: counts.critical })}
              </span>
            )}
            {(counts?.warning || 0) > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {t('alerts.warningCount', { count: counts.warning })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className={`overflow-y-auto ${isWidget ? 'max-h-96 px-4 py-3' : 'max-h-80'}`}>
        {isLoading ? (
          <div className="px-4 py-8 text-center">
            <p className="text-muted text-sm">{t('alerts.loading')}</p>
          </div>
        ) : total === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="text-foreground text-sm font-medium">{t('alerts.allClear')}</p>
            <p className="text-muted mt-1 text-xs">
              {t('alerts.stockStable')}
            </p>
          </div>
        ) : (
          <ul className={isWidget ? 'space-y-3' : 'divide-y divide-border/30'}>
            {visibleAlerts.map((alert) => (
              <li key={alert.id} className={isWidget ? '' : ''}>
                <AlertCard
                  alert={alert}
                  onAction={onAction}
                  onDismiss={onDismiss}
                  compact={!isWidget}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {onViewAll && total > 0 && (
        <div className="border-t border-border/40 px-4 py-2.5">
          <button
            type="button"
            onClick={onViewAll}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {t('alerts.viewDetails')}
          </button>
        </div>
      )}
    </div>
  )
}
