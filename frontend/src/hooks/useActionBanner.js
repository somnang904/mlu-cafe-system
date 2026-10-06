import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNotifications } from '../context/NotificationContext'

/**
 * Standard success/failure banners for writes the user triggers, so creating,
 * editing and deleting always report back the same way across the app.
 *
 *   const { notifySaved, notifyDeleted, notifyFailed } = useActionBanner()
 *   notifySaved(item.name)
 *   notifyFailed(err, 'delete')
 */
export function useActionBanner() {
  const { pushBanner } = useNotifications()
  const { t } = useTranslation()

  return useMemo(() => {
    const succeed = (titleKey) => (message) =>
      pushBanner({ title: t(titleKey), message: message || undefined, tone: 'success', durationMs: 4000 })

    return {
      notifyCreated: succeed('common.created'),
      notifySaved: succeed('common.saved'),
      notifyDeleted: succeed('common.deleted'),
      /** @param action 'save' | 'delete' — picks the title; the detail is the error text. */
      notifyFailed: (error, action = 'save') => {
        const detail = typeof error === 'string' ? error : error?.message
        return pushBanner({
          title: t(action === 'delete' ? 'common.deleteFailed' : 'common.saveFailed'),
          message: detail || t('common.actionFailed'),
          tone: 'error',
          durationMs: 8000,
        })
      },
    }
  }, [pushBanner, t])
}

export default useActionBanner
