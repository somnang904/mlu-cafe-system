import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function OperatingHoursNotice({ compact = false, className = '' }) {
  const { t } = useTranslation()
  const notice = t('settings.operatingHoursNotice')

  if (compact) {
    return (
      <p className={`text-2xs leading-snug text-muted-foreground ${className}`.trim()}>
        {notice}
      </p>
    )
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-2xl border border-forest-200 bg-forest-50/70 px-3 py-2 text-xs text-forest-800 dark:border-forest-800/60 dark:bg-forest-950/40 dark:text-forest-200 ${className}`.trim()}
    >
      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{notice}</p>
    </div>
  )
}
