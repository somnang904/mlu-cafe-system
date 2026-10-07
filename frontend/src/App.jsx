import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Login from './pages/Login'
import ForcePasswordChange from './pages/ForcePasswordChange'
import DashboardLayout from './components/common/DashboardLayout'
import ErrorBoundary from './components/common/ErrorBoundary'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ConnectionProvider } from './context/ConnectionContext'
import { POSProvider, usePOS } from './context/POSContext'
import { AlertsProvider } from './context/AlertsContext'
import { NotificationProvider } from './context/NotificationContext'
import { readActiveView, writeActiveView, VALID_VIEWS } from './utils/activeViewStorage'
import { getDefaultViewForUser } from './utils/permissions'

import Dashboard from './pages/Dashboard'
import Order from './pages/Order'
import Table from './pages/Table'
import Reservations from './pages/Reservations'
import Payment from './pages/Payment'
import MenuManagement from './pages/MenuManagement'
import SalesHistory from './pages/SalesHistory'
import InventoryStock from './pages/InventoryStock'
import ReportsAnalysis from './pages/ReportsAnalysis'
import Users from './pages/Users'
import BackupRecovery from './pages/BackupRecovery'
import SecurityAlerts from './pages/SecurityAlerts'

function AccessDenied({ onGoHome }) {
  const { t } = useTranslation()

  return (
    <div className="surface-card mx-auto flex max-w-lg flex-col items-center px-8 py-12 text-center">
      <h3 className="text-heading text-lg font-semibold">{t('common.accessRestricted')}</h3>
      <p className="text-muted mt-2 text-sm">{t('common.accessRestrictedDescription')}</p>
      <button type="button" onClick={onGoHome} className="btn-primary mt-6 px-4 py-2 text-sm">
        {t('common.goToAllowedPage')}
      </button>
    </div>
  )
}

function AuthenticatedApp() {
  const { user, canAccess, setActivePage: persistSessionActivePage } = useAuth()
  const { registerNavigate } = usePOS()
  const [activePage, setActivePage] = useState(() => readActiveView())

  const resolvedPage = useMemo(() => {
    if (!user) return activePage
    return canAccess(activePage) ? activePage : getDefaultViewForUser(user)
  }, [user, activePage, canAccess])

  const handleNavigate = useCallback(
    (page) => {
      if (!VALID_VIEWS.has(page)) return
      if (!canAccess(page)) return
      setActivePage(page)
      writeActiveView(page)
      persistSessionActivePage(page)
    },
    [canAccess, persistSessionActivePage],
  )

  useEffect(() => {
    registerNavigate(handleNavigate)
  }, [registerNavigate, handleNavigate])

  useEffect(() => {
    if (!user || resolvedPage === activePage) return
    setActivePage(resolvedPage)
    writeActiveView(resolvedPage)
    persistSessionActivePage(resolvedPage)
  }, [user, resolvedPage, activePage, persistSessionActivePage])

  useEffect(() => {
    const handlePageShow = (event) => {
      if (event.persisted) {
        const saved = readActiveView()
        if (saved && canAccess(saved)) {
          setActivePage(saved)
        }
      }
    }

    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [canAccess])

  const renderContentPage = () => {
    if (!canAccess(resolvedPage)) {
      return (
        <AccessDenied
          onGoHome={() => handleNavigate(getDefaultViewForUser(user))}
        />
      )
    }

    switch (resolvedPage) {
      case 'dashboard':
        return <Dashboard onNavigate={handleNavigate} />
      case 'order':
        return <Order />
      case 'table':
        return <Table />
      case 'reservations':
        return <Reservations />
      case 'payment':
        return <Payment />
      case 'menu':
        return <MenuManagement />
      case 'sales_history':
        return <SalesHistory />
      case 'inventory':
        return <InventoryStock view="items" onNavigate={handleNavigate} />
      case 'inventory_stocktake':
        return <InventoryStock view="stocktake" onNavigate={handleNavigate} />
      case 'inventory_expenses':
        return <InventoryStock view="expenses" onNavigate={handleNavigate} />
      case 'reports_analysis':
        return <ReportsAnalysis />
      case 'users':
        return <Users />
      case 'backup_recovery':
        return <BackupRecovery />
      case 'security_alerts':
        return <SecurityAlerts />
      default:
        return <Dashboard onNavigate={handleNavigate} />
    }
  }

  return (
    <div key="dashboard" className="page-enter">
      <DashboardLayout activePage={resolvedPage} onNavigate={handleNavigate}>
        <ErrorBoundary resetKey={resolvedPage}>{renderContentPage()}</ErrorBoundary>
      </DashboardLayout>
    </div>
  )
}

function AppRoutes() {
  const { isAuthenticated, login, user } = useAuth()

  if (!isAuthenticated) {
    return (
      <div key="login" className="page-enter">
        <Login onLogin={login} />
      </div>
    )
  }

  if (user?.must_change_password) {
    return <ForcePasswordChange />
  }

  return (
    <POSProvider>
      <NotificationProvider>
        <AlertsProvider>
          <AuthenticatedApp />
        </AlertsProvider>
      </NotificationProvider>
    </POSProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ConnectionProvider>
        <AppRoutes />
      </ConnectionProvider>
    </AuthProvider>
  )
}
