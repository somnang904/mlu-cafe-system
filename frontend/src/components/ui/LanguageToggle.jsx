import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function LanguageToggle({ className = '' }) {
  const { t, i18n } = useTranslation()
  const isKhmer = i18n.language === 'km'

  const toggleLanguage = () => {
    i18n.changeLanguage(isKhmer ? 'en' : 'km')
  }

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      aria-label={isKhmer ? t('a11y.switchToEnglish') : t('a11y.switchToKhmer')}
      className={`interactive-btn flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-forest-200 bg-forest-50 px-3.5 text-sm font-semibold transition-colors dark:border-forest-800/60 dark:bg-forest-950/40 ${className}`}
    >
      <Languages className="h-3.5 w-3.5 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
      <span className="whitespace-nowrap text-forest-800 dark:text-forest-100">
        {isKhmer ? 'ខ្មែរ' : 'EN'}
      </span>
    </button>
  )
}
