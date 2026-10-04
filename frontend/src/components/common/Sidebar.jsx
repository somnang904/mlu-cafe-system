import { useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useAuth } from '../../context/AuthContext'

import { STORE } from '../../config/store'
import BrandLogo from './BrandLogo'
import ConfirmDeleteModal from '../ui/ConfirmDeleteModal'

import {

  LayoutDashboard,

  ShoppingCart,

  Coffee,

  CalendarClock,

  CreditCard,

  UtensilsCrossed,

  History,

  Layers,

  Users,

  ShieldAlert,

  Settings,

  HardDrive,

  FolderOpen,

  FileBarChart,

  ChevronDown,

  LogOut,

  X,

  Package,

  ClipboardList,

  Wallet,

} from 'lucide-react'

import { canSeeNavItem } from '../../utils/permissions'

const WORK_ROLES = ['admin', 'cashier', 'staff']

const sidebarNavigation = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, roles: WORK_ROLES },
  { id: 'order', labelKey: 'nav.order', icon: ShoppingCart, roles: WORK_ROLES },
  { id: 'table', labelKey: 'nav.table', icon: Coffee, roles: WORK_ROLES },
  { id: 'payment', labelKey: 'nav.payment', icon: CreditCard, roles: WORK_ROLES },
  { id: 'reservations', labelKey: 'nav.reservations', icon: CalendarClock, roles: WORK_ROLES },
  { id: 'sales_history', labelKey: 'nav.salesHistory', icon: History, roles: WORK_ROLES },
  {
    id: 'stock',
    labelKey: 'nav.inventoryStock',
    icon: Layers,
    children: [
      { id: 'inventory', labelKey: 'nav.stockItems', icon: Package, roles: WORK_ROLES },
      { id: 'inventory_stocktake', labelKey: 'nav.stocktake', icon: ClipboardList, roles: WORK_ROLES },
      { id: 'inventory_expenses', labelKey: 'nav.expenses', icon: Wallet, roles: WORK_ROLES },
    ],
  },
  { id: 'menu', labelKey: 'nav.menuManagement', icon: UtensilsCrossed, roles: WORK_ROLES },
  { id: 'reports_analysis', labelKey: 'nav.reports', icon: FileBarChart, roles: WORK_ROLES },
  { id: 'users', labelKey: 'nav.users', icon: Users, roles: ['admin'], adminOnly: true },
  {
    id: 'more',
    labelKey: 'nav.others',
    icon: FolderOpen,
    children: [
      { id: 'settings', labelKey: 'nav.settings', icon: Settings, roles: WORK_ROLES },
      { id: 'security_alerts', labelKey: 'nav.securityAlerts', icon: ShieldAlert, roles: ['admin'], adminOnly: true },
      { id: 'backup_recovery', labelKey: 'nav.backupRecovery', icon: HardDrive, roles: WORK_ROLES },
    ],
  },
]



function SidebarNavButton({ item, isActive, onNavigate, compact = false }) {

  const { t } = useTranslation()

  const IconComponent = item.icon

  const label = t(item.labelKey)



  return (

    <button

      type="button"

      onClick={() => onNavigate(item.id)}

      title={label}

      aria-label={label}

      aria-current={isActive ? 'page' : undefined}

      className={`group interactive-nav flex min-h-9 w-full cursor-pointer select-none items-center rounded-xl text-sm ${

        compact

          ? 'gap-2 py-1 pl-3 pr-2 lg:gap-3 lg:pl-4'

          : 'justify-center gap-0 px-2 py-1 sm:justify-center lg:justify-start lg:gap-3 lg:px-3'

      } ${isActive ? 'nav-item-active' : 'nav-item-inactive'}`}

    >

      <IconComponent

        className={`h-[1.125rem] w-[1.125rem] shrink-0 transition-colors ${

          isActive ? 'text-forest-600 dark:text-forest-400' : 'text-slate-500 group-hover:text-slate-800 dark:text-zinc-400 dark:group-hover:text-zinc-200'

        }`}

      />

      <span className={`truncate ${compact ? 'inline' : 'hidden max-sm:inline lg:inline'}`}>{label}</span>

    </button>

  )

}



function NavFolder({

  labelKey,

  folderIcon: FolderIcon,

  activePage,

  onNavigate,

  items,

  expanded,

  onToggleExpanded,

}) {

  const { t } = useTranslation()



  if (!items.length) return null

  const isChildActive = items.some((item) => item.id === activePage)



  return (

    <>

      <div className="hidden lg:block">

        <div className="space-y-1">

          <button

            type="button"

            onClick={onToggleExpanded}

            aria-expanded={expanded}

            className={`interactive-nav flex min-h-9 w-full cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-1.5 text-sm ${

              isChildActive ? 'nav-item-active font-medium' : 'nav-item-inactive'

            }`}

          >

            <FolderIcon className="h-[1.125rem] w-[1.125rem] shrink-0 text-slate-500 dark:text-zinc-400" />

            <span className="flex-1 truncate text-left">{t(labelKey)}</span>

            <ChevronDown

              className={`h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-600 transition-transform duration-300 dark:text-zinc-400 ${

                expanded ? 'rotate-180' : ''

              }`}

            />

          </button>

          <div
            className={`grid transition-[grid-template-rows] duration-300 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            inert={expanded ? undefined : true}
          >

            <div className="overflow-hidden">

              <div className="space-y-0.5 border-l border-border py-1 pl-2 ml-3">

                {items.map((item) => (

                  <SidebarNavButton

                    key={item.id}

                    item={item}

                    isActive={activePage === item.id}

                    onNavigate={onNavigate}

                    compact

                  />

                ))}

              </div>

            </div>

          </div>

        </div>

      </div>

      <div className="space-y-1 lg:hidden">

        {items.map((item) => (

          <SidebarNavButton

            key={item.id}

            item={item}

            isActive={activePage === item.id}

            onNavigate={onNavigate}

          />

        ))}

      </div>

    </>

  )

}



export default function Sidebar({ activePage, onNavigate, mobileOpen = false, onMobileClose }) {

  const { t } = useTranslation()

  const { user, logout } = useAuth()

  const [expandedGroups, setExpandedGroups] = useState({})

  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const visibleNav = useMemo(
    () =>
      sidebarNavigation.flatMap((item) => {
        if (item.children) {
          const children = item.children.filter((child) => canSeeNavItem(user, child))
          if (children.length === 0) return []
          // One child only: show it as a top-level item instead of a More group.
          if (children.length === 1) return children
          return [{ ...item, children }]
        }
        return canSeeNavItem(user, item) ? [item] : []
      }),
    [user],
  )

  const activeGroupId = visibleNav.find((item) => item.children?.some((child) => child.id === activePage))?.id
  const navRef = useRef(null)
  const [showNavFade, setShowNavFade] = useState(false)

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return undefined

    const updateFade = () => {
      const overflows = nav.scrollHeight > nav.clientHeight + 1
      const atBottom = nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 2
      setShowNavFade(overflows && !atBottom)
    }

    updateFade()
    const observer = new ResizeObserver(updateFade)
    observer.observe(nav)
    nav.addEventListener('scroll', updateFade, { passive: true })
    return () => {
      observer.disconnect()
      nav.removeEventListener('scroll', updateFade)
    }
  }, [visibleNav, expandedGroups])

  // Reveal the group that owns the current page whenever navigation changes.
  const [syncedPage, setSyncedPage] = useState(null)

  if (syncedPage !== activePage) {
    setSyncedPage(activePage)
    if (activeGroupId && !expandedGroups[activeGroupId]) {
      setExpandedGroups((prev) => ({ ...prev, [activeGroupId]: true }))
    }
  }



  const handleNavigate = (pageId) => {

    onNavigate(pageId)

    onMobileClose?.()

  }



  return (

    <>

    <aside

      className={`fixed inset-y-0 left-0 z-50 flex h-screen min-h-0 w-[min(18rem,88vw)] flex-col overflow-hidden border-r border-cocoa-100 bg-white/90 p-2 backdrop-blur-md transition-transform duration-300 ease-out dark:border-border dark:bg-card/90 sm:relative sm:z-auto sm:w-[4.5rem] sm:translate-x-0 sm:p-1.5 lg:w-60 lg:p-3 ${

        mobileOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'

      }`}

    >

      <div className="relative mb-1 flex w-full shrink-0 flex-col items-center justify-center gap-1 px-1 py-1.5">

        <BrandLogo

          glow

          src={STORE.sidebarLogoUrl}

          className="h-auto w-[88px] max-w-[78%] object-contain sm:w-10 sm:max-w-full lg:w-[100px] lg:max-w-[112px]"

          title={STORE.officialName}

        />

        <p className="text-center text-sm font-medium leading-tight text-foreground sm:hidden lg:block">

          Mlu Kitchen & Cafe

          <span className="block">Siem Reap</span>

        </p>

        <button

          type="button"

          onClick={onMobileClose}

          className="absolute right-2 top-1/2 flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-full text-olive-400 hover:bg-olive-50 sm:hidden"

          aria-label={t('a11y.closeNavigationMenu')}

        >

          <X className="h-5 w-5" />

        </button>

      </div>



      <div className="relative min-h-0 flex-1">
      <nav ref={navRef} className="no-scrollbar h-full space-y-0.5 overflow-y-auto overflow-x-hidden">

        {visibleNav.map((item) =>
          item.children ? (
            <NavFolder
              key={item.id}
              labelKey={item.labelKey}
              folderIcon={item.icon}
              activePage={activePage}
              onNavigate={handleNavigate}
              items={item.children}
              expanded={Boolean(expandedGroups[item.id])}
              onToggleExpanded={() => setExpandedGroups((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
            />
          ) : (
            <SidebarNavButton
              key={item.id}
              item={item}
              isActive={activePage === item.id}
              onNavigate={handleNavigate}
            />
          ),
        )}

      </nav>
      {showNavFade ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent dark:from-[#1a1815]"
        />
      ) : null}
      </div>



      <div className="mt-1 shrink-0 border-t border-border pt-2">

        <button

          type="button"

          onClick={() => setConfirmSignOut(true)}

          className="interactive-nav flex min-h-9 w-full cursor-pointer select-none items-center justify-center gap-0 rounded-xl px-2 py-1.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 lg:justify-start lg:gap-3 lg:px-3 dark:text-rose-400 dark:hover:bg-rose-950/30"

        >

          <LogOut className="h-[1.125rem] w-[1.125rem] shrink-0" />

          <span className="hidden max-sm:inline lg:inline">{t('nav.signOut')}</span>

        </button>

      </div>

    </aside>

    {/* Rendered outside <aside>: its transform/backdrop-blur would trap a fixed overlay inside the sidebar. */}
    <ConfirmDeleteModal
      isOpen={confirmSignOut}
      title={t('nav.signOutConfirmTitle')}
      message={t('nav.signOutConfirmMessage')}
      confirmLabel={t('nav.signOut')}
      onCancel={() => setConfirmSignOut(false)}
      onConfirm={() => {
        setConfirmSignOut(false)
        onMobileClose?.()
        logout()
      }}
    />

    </>

  )

}


