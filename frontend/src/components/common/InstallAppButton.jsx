import { MonitorDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useInstallPrompt } from '../../utils/pwaInstall'
import Tooltip from '../ui/Tooltip'

// Admin-only: installs the system as a desktop/phone app so staff open it from an
// icon instead of typing or pasting the address.
export default function InstallAppButton() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const { canInstall, install } = useInstallPrompt()

  if (!isAdmin || !canInstall) return null

  return (
    <Tooltip label={t('pwa.installApp')}>
      <button
        type="button"
        onClick={install}
        aria-label={t('pwa.installAppLong')}
        className="interactive-btn relative flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-forest-500/30 bg-forest-50 px-3 text-sm font-semibold text-forest-700 transition-all hover:border-forest-500/60 hover:bg-forest-100 active:scale-95 sm:px-4 dark:border-forest-400/30 dark:bg-forest-950/50 dark:text-forest-300 dark:hover:bg-forest-900/60"
      >
        <MonitorDown className="h-5 w-5" aria-hidden />
        <span className="hidden md:inline">{t('pwa.installApp')}</span>
      </button>
    </Tooltip>
  )
}
