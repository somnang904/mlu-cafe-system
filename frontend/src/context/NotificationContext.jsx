import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NotificationContext = createContext(null)

const TONE_STYLES = {
  success: {
    panel:
      'border-forest-200/80 bg-white/95 text-forest-950 dark:border-forest-800/50 dark:bg-obsidian-850/95 dark:text-forest-50',
    chip: 'bg-forest-100 text-forest-700 dark:bg-forest-900/60 dark:text-forest-300',
    bar: 'bg-forest-500',
    icon: CheckCircle2,
  },
  warning: {
    panel:
      'border-amber-200/80 bg-white/95 text-amber-950 dark:border-amber-800/50 dark:bg-obsidian-850/95 dark:text-amber-50',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
    bar: 'bg-amber-500',
    icon: AlertTriangle,
  },
  error: {
    panel:
      'border-red-200/80 bg-white/95 text-red-950 dark:border-red-800/50 dark:bg-obsidian-850/95 dark:text-red-50',
    chip: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300',
    bar: 'bg-red-500',
    icon: AlertCircle,
  },
}

function toneStyle(tone) {
  if (tone === 'error' || tone === 'critical') return TONE_STYLES.error
  if (tone === 'warning') return TONE_STYLES.warning
  return TONE_STYLES.success
}

export function NotificationProvider({ children }) {
  const { t } = useTranslation()
  const [banners, setBanners] = useState([])

  const dismissBanner = useCallback((id) => {
    setBanners((prev) => prev.filter((banner) => banner.id !== id))
  }, [])

  const pushBanner = useCallback(
    ({ title, message, tone = 'success', durationMs = 6000 }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setBanners((prev) => [...prev, { id, title, message, tone, durationMs }])
      if (durationMs > 0) {
        window.setTimeout(() => dismissBanner(id), durationMs)
      }
      return id
    },
    [dismissBanner],
  )

  const value = useMemo(
    () => ({
      pushBanner,
      dismissBanner,
    }),
    [pushBanner, dismissBanner],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[90] flex flex-col items-center gap-2.5 px-4 print:hidden">
        {banners.map((banner) => {
          const style = toneStyle(banner.tone)
          const IconComponent = style.icon
          const isError = style === TONE_STYLES.error

          return (
            <div
              key={banner.id}
              className={`banner-toast pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border shadow-apple-md backdrop-blur-xl ${style.panel}`}
              role={isError ? 'alert' : 'status'}
              aria-live={isError ? 'assertive' : 'polite'}
            >
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.chip}`}
                  aria-hidden
                >
                  <IconComponent className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.4} />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold leading-snug">{banner.title}</p>
                  {banner.message ? (
                    <p className="mt-0.5 break-words text-[13px] leading-snug opacity-75">{banner.message}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismissBanner(banner.id)}
                  className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-40 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                  aria-label={t('a11y.close')}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              {banner.durationMs > 0 ? (
                <span
                  className={`banner-countdown absolute inset-x-0 bottom-0 block h-0.5 ${style.bar}`}
                  style={{ animationDuration: `${banner.durationMs}ms` }}
                  aria-hidden
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationProvider')
  }
  return ctx
}
