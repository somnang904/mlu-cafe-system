import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { t } = useTranslation()
  const [banners, setBanners] = useState([])

  const dismissBanner = useCallback((id) => {
    setBanners((prev) => prev.filter((banner) => banner.id !== id))
  }, [])

  const pushBanner = useCallback(
    ({ title, message, tone = 'success', durationMs = 6000 }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setBanners((prev) => [...prev, { id, title, message, tone }])
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
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex flex-col items-center gap-2 px-4 print:hidden">
        {banners.map((banner) => {
          const isCriticalOrError = banner.tone === 'error' || banner.tone === 'critical'
          const toneClass =
            isCriticalOrError
              ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-800/60 dark:bg-red-950/90 dark:text-red-100'
              : banner.tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/90 dark:text-amber-100'
                : 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/90 dark:text-emerald-50'

          const IconComponent =
            isCriticalOrError
              ? AlertCircle
              : banner.tone === 'warning'
                ? AlertTriangle
                : CheckCircle2

          return (
            <div
              key={banner.id}
              className={`pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${toneClass}`}
              role="status"
            >
              <IconComponent className="mt-0.5 h-5 w-5 shrink-0 opacity-80" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{banner.title}</p>
                {banner.message ? (
                  <p className="mt-0.5 text-sm opacity-90">{banner.message}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismissBanner(banner.id)}
                className="rounded-full p-1 opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                aria-label={t('common.dismissNotification')}
              >
                <X className="h-4 w-4" />
              </button>
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
