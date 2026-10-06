import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function ModalHeader({
  icon: Icon,
  iconClassName = 'text-forest-600 dark:text-forest-400',
  title,
  subtitle,
  onClose,
  titleId,
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon ? <Icon className={`h-6 w-6 shrink-0 ${iconClassName}`} aria-hidden /> : null}
        <div className="min-w-0">
          <h3 id={titleId} className="text-heading truncate text-lg font-bold">
            {title}
          </h3>
          {subtitle ? <p className="text-muted text-xs">{subtitle}</p> : null}
        </div>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('a11y.close')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-zinc-800"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
