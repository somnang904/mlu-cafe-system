import { useState, useCallback } from 'react'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Sidebar from './Sidebar'
import ThemeToggle from '../ui/ThemeToggle'
import LanguageToggle from '../ui/LanguageToggle'
import NotificationBell from './NotificationBell'
import { useAuth } from '../../context/AuthContext'
import { useConnection } from '../../context/ConnectionContext'

const ENGLISH_ROLE_TITLES = new Set([
  'system administrator',
  'administrator',
  'admin',
  'cashier',
  'supervisor',
  'staff',
])

function formatNavRoleLabel(user, t) {
  if (!user?.role) return t('nav.defaultRole')
  const role = String(user.role).trim()
  if (/^admin$/i.test(role)) return t('nav.systemAdministratorRole')
  if (/^cashier$/i.test(role) || /^supervisor$/i.test(role)) return t('users.roles.cashier')
  if (/^staff$/i.test(role)) return t('users.roles.staff')
  return role
}

function formatHeaderName(user, t) {
  const storedName = String(user?.display_name || user?.displayName || '').trim()
  const roleLabel = formatNavRoleLabel(user, t)
  if (!storedName || ENGLISH_ROLE_TITLES.has(storedName.toLowerCase())) {
    return roleLabel
  }
  return storedName
}

export default function DashboardLayout({ children, activePage, onNavigate }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { backendReachable, internetOnline } = useConnection()
  const headerName = formatHeaderName(user, t)
  const navRoleLabel = formatNavRoleLabel(user, t)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  return (
    <div className="liquid-glass flex h-screen w-full max-w-[100vw] overflow-hidden bg-background text-foreground transition-colors duration-300">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label={t('a11y.closeMenuOverlay')}
          className="modal-backdrop fixed inset-0 z-40 sm:hidden"
          onClick={closeMobileNav}
        />
      ) : null}

      <Sidebar
        activePage={activePage}
        onNavigate={onNavigate}
        mobileOpen={mobileNavOpen}
        onMobileClose={closeMobileNav}
      />

      <div className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -right-1/4 -top-1/4 h-1/2 w-1/2 rounded-full bg-forest-500/[0.03] blur-3xl" />
          <div className="absolute -left-1/4 -bottom-1/4 h-1/2 w-1/2 rounded-full bg-olive-200/20 blur-3xl" />
        </div>

        <header className="relative z-40 flex shrink-0 items-center gap-3 border-b border-cocoa-100 bg-white/80 px-4 py-2.5 backdrop-blur-md sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/80">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-border bg-card text-foreground sm:hidden"
            aria-label={t('a11y.openNavigationMenu')}
            aria-expanded={mobileNavOpen}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {headerName}
            </p>
            {navRoleLabel && navRoleLabel !== headerName ? (
              <p className="truncate text-xs font-medium text-slate-600 dark:text-zinc-400">{navRoleLabel}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!backendReachable ? (
              <p className="max-w-[14rem] text-right text-[11px] leading-snug text-amber-800 dark:text-amber-200 sm:max-w-[18rem]" role="status">
                {t('connection.serverDown')}
              </p>
            ) : !internetOnline ? (
              <p className="max-w-[12rem] text-right text-[11px] leading-snug text-muted sm:max-w-[16rem]" role="status">
                {t('connection.noInternet')}
              </p>
            ) : null}
            <NotificationBell onNavigate={onNavigate} />
            <LanguageToggle />
            <ThemeToggle variant="icon" />
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
