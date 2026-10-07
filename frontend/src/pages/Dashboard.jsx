import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Wallet,
} from 'lucide-react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useSettings } from '../context/SettingsContext'
import { useAlerts } from '../context/AlertsContext'
import AlertCenter from '../components/alerts/AlertCenter'
import LiveConditions from '../components/dashboard/LiveConditions'
import FinanceBarChart from '../components/charts/FinanceBarChart'
import MenuItemImage from '../components/menu/MenuItemImage'
import { apiFetch, getAuthToken } from '../services/apiClient'
import { readLiveConditions, writeLiveConditions } from '../utils/liveConditionsCache'
import { userHasPermission } from '../utils/permissions'
import {
  buildDashboardStats,
  buildPaymentSplitData,
  buildPopularPicks,
  buildRecentOrders,
  buildWeeklySalesData,
} from '../utils/dashboardAnalytics'
import { translateMenuName, translateMenuSummary } from '../utils/menuNameTranslations'
import { formatOrderDate } from '../utils/dateTimeFormat'

const API_PATH = '/orders/history?days=60'
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function useChartTheme() {
  const { isDark } = useTheme()

  return useMemo(
    () => ({
      axis: isDark ? '#aeaeb2' : '#86868b',
      grid: isDark ? '#3a3a3c' : '#e5e5e7',
      tooltipBg: isDark ? '#1d1d1f' : '#ffffff',
      tooltipBorder: isDark ? '#3a3a3c' : '#e5e5e7',
      tooltipText: isDark ? '#f5f5f7' : '#1d1d1f',
      primary: isDark ? '#34d399' : '#10b981',
      primarySoft: isDark ? '#064e3b' : '#d1fae5',
      secondary: isDark ? '#c9a882' : '#8b5e34',
      muted: isDark ? '#aeaeb2' : '#86868b',
    }),
    [isDark],
  )
}

function PaymentTooltip({ active, payload, theme }) {
  if (!active || !payload?.length) return null

  return (
    <div
      className="rounded-xl border px-3 py-2 shadow-lg"
      style={{
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        color: theme.tooltipText,
      }}
    >
      <p className="text-sm font-semibold">{payload[0].name}</p>
      <p className="text-xs" style={{ color: theme.muted }}>
        ${Number(payload[0].value).toFixed(2)}
      </p>
    </div>
  )
}

function paymentMethodLabel(name, t) {
  if (name === 'Bank Scan') return t('payment.methods.bankScan')
  if (name === 'Cash') return t('payment.methods.cash')
  return name
}

export default function Dashboard({ onNavigate }) {
  const { t, i18n } = useTranslation()
  const { user, isAdmin } = useAuth()
  const canSeeReports = isAdmin || userHasPermission(user, 'reports')
  const chartTheme = useChartTheme()
  const { lowStockAlertsEnabled, loginAlertsEnabled } = useSettings()
  const { alerts, counts, isLoading: alertsLoading, error: alertsError, refresh, markNotificationRead } = useAlerts()
  const [orders, setOrders] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [liveConditions, setLiveConditions] = useState(() => readLiveConditions())
  const [liveStale, setLiveStale] = useState(false)
  const [todaySpending, setTodaySpending] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [liveLoading, setLiveLoading] = useState(() => !readLiveConditions())

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const token = getAuthToken()
    if (!token) {
      setIsLoading(false)
      setLiveLoading(false)
      return undefined
    }

    let cancelled = false
    const spendingPromise = canSeeReports
      ? apiFetch('/expenses/summary', { token })
          .then((res) => (res.ok ? res.json() : { todaySpending: 0 }))
          .then((data) => Number(data.todaySpending) || 0)
          .catch(() => 0)
      : Promise.resolve(0)

    Promise.all([
      apiFetch(API_PATH, { token })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => (Array.isArray(data) ? data : []))
        .catch(() => []),
      spendingPromise,
      apiFetch('/menu', { token })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => (Array.isArray(data) ? data : []))
        .catch(() => []),
    ])
      .then(([orderRows, spending, menuRows]) => {
        if (cancelled) return
        setOrders(orderRows)
        setTodaySpending(spending)
        setMenuItems(menuRows)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    const fetchLive = ({ showLoading = false } = {}) => {
      if (showLoading) setLiveLoading(true)
      return apiFetch('/dashboard/live', { token })
        .then((res) => (res.ok ? res.json() : null))
        .then((live) => {
          if (cancelled) return
          const weather = live?.weather?.ok ? live.weather : null
          const exchange = live?.exchange?.ok ? live.exchange : null
          if (weather || exchange) {
            const saved = writeLiveConditions({ weather, exchange })
            setLiveConditions(saved)
            setLiveStale(false)
          } else {
            setLiveStale(Boolean(readLiveConditions()))
          }
        })
        .catch(() => {
          if (!cancelled) setLiveStale(Boolean(readLiveConditions()))
        })
        .finally(() => {
          if (!cancelled) setLiveLoading(false)
        })
    }

    // Weather is live (~2 min server cache); exchange is daily — polling keeps weather fresh.
    fetchLive({ showLoading: !readLiveConditions() })
    const liveInterval = setInterval(() => {
      if (!getAuthToken()) return
      fetchLive()
    }, 2 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(liveInterval)
    }
  }, [canSeeReports])

  const weeklySales = useMemo(() => buildWeeklySalesData(orders), [orders])
  const localizedWeeklySales = useMemo(
    () =>
      weeklySales.map((day) => {
        const weekday = new Date(`${day.key}T12:00:00`).getDay()
        return {
          ...day,
          label: t(`dates.weekdays.${WEEKDAY_KEYS[weekday]}`),
        }
      }),
    [weeklySales, t],
  )
  const paymentSplit = useMemo(() => buildPaymentSplitData(orders), [orders])
  const paymentMonthLabel = useMemo(() => {
    const key = paymentSplit[0]?.monthKey || formatOrderDate(new Date()).slice(0, 7)
    const [year, month] = key.split('-').map(Number)
    if (!year || !month) return ''
    return new Date(year, month - 1, 1).toLocaleDateString(i18n.language === 'km' ? 'km-KH' : 'en-US', {
      month: 'long',
      year: 'numeric',
    })
  }, [paymentSplit, i18n.language])
  const dashboardStats = useMemo(
    () => buildDashboardStats(orders, user, todaySpending),
    [orders, user, todaySpending],
  )
  const recentOrders = useMemo(() => buildRecentOrders(orders), [orders])
  const popularPicks = useMemo(() => {
    const picks = buildPopularPicks(orders, 6)
    const menuByName = new Map(
      menuItems.map((item) => [String(item.name || '').trim().toLowerCase(), item]),
    )
    const menuById = new Map(
      menuItems.map((item) => [Number(item.id), item]),
    )
    return picks.map((pick) => {
      // 1. By menu_item_id if available
      let menuItem = pick.menuItemId ? menuById.get(Number(pick.menuItemId)) : null
      // 2. Direct exact name match (e.g. "Fresh Mango")
      if (!menuItem) {
        menuItem = menuByName.get(pick.name.toLowerCase())
      }
      // 3. Clean base name (strip "(Hot)", "(Iced · Sugar: 100%)", etc.)
      if (!menuItem) {
        const cleanName = pick.name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
        menuItem = menuByName.get(cleanName)
      }
      return {
        ...pick,
        imageUrl: pick.imageUrl || menuItem?.image_url || '',
        menuItemId: menuItem?.id ?? pick.menuItemId ?? null,
      }
    })
  }, [orders, menuItems])

  const paymentColors = [chartTheme.primary, chartTheme.secondary, chartTheme.muted]
  const localizedPaymentSplit = useMemo(
    () =>
      paymentSplit.map((entry) => ({
        ...entry,
        name: paymentMethodLabel(entry.name, t),
        value: Math.max(0, entry.value),
        amount: entry.value,
      })),
    [paymentSplit, t],
  )
  const paymentTotal = localizedPaymentSplit.reduce((sum, item) => sum + item.value, 0)

  const openPopularPick = (pick) => {
    if (pick.menuItemId == null) return
    onNavigate?.('order')
    if (!window.location.hash.startsWith('#/order')) return
    const url = new URL(window.location.href)
    url.searchParams.set('item', String(pick.menuItemId))
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const handleAlertAction = (alert) => {
    onNavigate?.(
      alert?.action?.navigateTo ||
        (alert?.category === 'security_alert'
          ? 'security_alerts'
          : alert?.category === 'password_reset'
            ? 'users'
            : alert?.category === 'reservation'
              ? 'reservations'
              : alert?.category === 'expense'
                ? 'reports'
                : 'inventory'),
    )
  }

  const hasSecurityAlerts = alerts.some((alert) => alert.category === 'password_reset')
  const hasLoginLockAlerts = alerts.some((alert) => alert.category === 'security_alert')
  const hasReservationAlerts = alerts.some((alert) => alert.category === 'reservation')
  const hasExpenseAlerts = alerts.some((alert) => alert.category === 'expense')
  const showAlertCenter =
    lowStockAlertsEnabled ||
    (isAdmin && (hasSecurityAlerts || hasExpenseAlerts || (loginAlertsEnabled && hasLoginLockAlerts))) ||
    hasReservationAlerts ||
    hasExpenseAlerts

  const stats = [
    {
      title: t('dashboard.todaySales', { defaultValue: "Today's Sales" }),
      value: `$${dashboardStats.todayRevenue.toFixed(2)}`,
      change:
        dashboardStats.todayRefundCount > 0
          ? `${dashboardStats.todayOrderCount} ${t('dashboard.ordersToday', { defaultValue: 'orders today' })} · ${t('dashboard.refundsToday', {
              refunds: dashboardStats.todayRefunds.toFixed(2),
              net: dashboardStats.todayNetSales.toFixed(2),
            })}`
          : `${dashboardStats.todayOrderCount} ${t('dashboard.ordersToday', { defaultValue: 'orders today' })}`,
      icon: DollarSign,
      color: 'bg-forest-500',
      light: 'badge-forest',
    },
    ...(canSeeReports
      ? [
          {
            title: t('dashboard.todaySpending', { defaultValue: "Today's Spending" }),
            value: `$${dashboardStats.todaySpending.toFixed(2)}`,
            change: t('dashboard.spendingHint', { defaultValue: 'Logged expenses' }),
            icon: Wallet,
            color: 'bg-cocoa-600',
            light: 'badge-olive',
          },
          {
            title: t('dashboard.netProfit', { defaultValue: 'Net Profit' }),
            value: `$${dashboardStats.netProfit.toFixed(2)}`,
            change: t('dashboard.netProfitHint', { defaultValue: 'Income − Spending' }),
            icon: dashboardStats.netProfit >= 0 ? TrendingUp : TrendingDown,
            color: dashboardStats.netProfit >= 0 ? 'bg-emerald-600' : 'bg-red-600',
            light: dashboardStats.netProfit >= 0 ? 'badge-forest' : 'badge-olive',
          },
        ]
      : []),
    {
      title: t('dashboard.activeCashier', { defaultValue: 'Active Cashier' }),
      value: dashboardStats.cashierName,
      change: t('dashboard.onDuty', { defaultValue: 'On duty' }),
      icon: UserCheck,
      color: 'bg-olive-600',
      light: 'badge-forest',
    },
  ]

  return (
    <div className="space-y-6 page-enter">
      <div>
        <h3 className="page-title">{t('nav.dashboard')}</h3>
      </div>

      <LiveConditions
        weather={liveConditions?.weather}
        exchange={liveConditions?.exchange}
        weatherSavedAt={liveConditions?.weatherSavedAt}
        exchangeSavedAt={liveConditions?.exchangeSavedAt}
        savedAt={liveConditions?.savedAt}
        isStale={liveStale}
        isLoading={liveLoading}
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div
              key={stat.title}
              className="surface-card min-w-0 p-5"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted text-sm font-medium">{stat.title}</p>
                  <p className="text-heading mt-2 line-clamp-2 break-words text-3xl font-semibold tracking-tight tabular-nums">{stat.value}</p>
                  <p className={`mt-2 inline-flex max-w-full items-center gap-1 ${stat.light}`}>
                    <TrendingUp className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 break-words">{stat.change}</span>
                  </p>
                </div>
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${stat.color} text-white shadow-sm`}
                >
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="surface-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-heading text-lg">{t('dashboard.popularPicks')}</h3>
            <p className="text-muted mt-1 text-sm">{t('dashboard.popularPicksHint')}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {popularPicks.length === 0 ? (
            <p className="text-muted col-span-full text-sm">
              {isLoading ? t('dashboard.loadingOrders') : t('dashboard.noPopularPicks')}
            </p>
          ) : (
            popularPicks.map((pick, index) => {
              const label = translateMenuName(pick.name, i18n.language, t)
              return (
                <button
                  key={pick.menuItemId ?? pick.name}
                  type="button"
                  disabled={pick.menuItemId == null}
                  onClick={() => openPopularPick(pick)}
                  aria-label={label}
                  className="surface-inset flex w-full cursor-pointer flex-col items-center px-3 py-4 text-center transition hover:border-forest-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-600 disabled:cursor-default disabled:shadow-none"
                >
                  <MenuItemImage
                    imageUrl={pick.imageUrl}
                    alt=""
                    eager={index < 6}
                    className="h-16 w-16 rounded-xl border border-slate-100 object-cover dark:border-zinc-800"
                  />
                  <p className="text-heading mt-3 line-clamp-2 text-sm font-semibold">
                    {label}
                  </p>
                  <p className="text-muted mt-1 text-xs tabular-nums">
                    {t('dashboard.soldCount', { count: pick.sold })}
                  </p>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="surface-card p-6">
          <h3 className="text-heading text-lg">{t('dashboard.weeklySales')}</h3>
          <p className="text-muted mt-1 text-sm">{t('dashboard.weeklySalesDescription')}</p>
          <div className="mt-6 h-72 w-full">
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-muted text-sm">{t('dashboard.loadingChart')}</p>
              </div>
            ) : (
              <FinanceBarChart
                data={localizedWeeklySales}
                mode="income-only"
                tickMode="daily"
                incomeLabel={t('reports.income')}
                emptyLabel={t('dashboard.noSalesYet')}
              />
            )}
          </div>
        </div>

        <div className="surface-card p-6">
          <h3 className="text-heading text-lg">{t('dashboard.paymentSplit')}</h3>
          <p className="text-muted mt-1 text-sm">
            {t('dashboard.paymentSplitMonth', { month: paymentMonthLabel })}
          </p>
          <div className="mt-4 flex flex-col items-center">
            <div className="h-52 w-full">
              {isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-muted text-sm">{t('dashboard.loadingChart')}</p>
                </div>
              ) : paymentTotal === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-muted text-sm">{t('dashboard.noPaymentData')}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={localizedPaymentSplit}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={82}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {localizedPaymentSplit.map((entry, index) => (
                        <Cell key={entry.name} fill={paymentColors[index % paymentColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => (
                        <PaymentTooltip active={active} payload={payload} theme={chartTheme} />
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="mt-2 w-full space-y-3">
              {localizedPaymentSplit.map((entry, index) => {
                const percent = paymentTotal > 0 ? (entry.value / paymentTotal) * 100 : 0
                return (
                  <div key={entry.name}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: paymentColors[index] }}
                        />
                        <span className="text-foreground">{entry.name}</span>
                      </div>
                      <span className="text-heading font-semibold tabular-nums">
                        ${entry.amount.toFixed(2)} ({percent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-background/80 dark:bg-card/40">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${percent}%`,
                          backgroundColor: paymentColors[index],
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="text-muted mt-4 text-center text-xs">
              {t('dashboard.totalProcessed')}{' '}
              <span className="text-heading font-semibold tabular-nums">
                ${paymentTotal.toFixed(2)}
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="surface-card p-6">
        <h3 className="text-heading text-lg">{t('dashboard.recentOrders')}</h3>
        <div className="mt-6 space-y-4">
          {recentOrders.length === 0 ? (
            <p className="text-muted text-sm">
              {isLoading ? t('dashboard.loadingOrders') : t('dashboard.noOrders')}
            </p>
          ) : (
            recentOrders.map((order) => (
              <div
                key={order.id}
                className="surface-inset flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0 pr-3">
                  <p className="text-heading font-medium">{order.id}</p>
                  <p className="text-muted truncate text-sm">
                    {translateMenuSummary(order.item, i18n.language, t)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold text-primary tabular-nums">{order.total}</p>
                  <p className="text-muted text-xs">{order.time}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showAlertCenter && (
        <AlertCenter
          alerts={alerts}
          counts={counts}
          isLoading={alertsLoading}
          error={alertsError}
          onAction={handleAlertAction}
          onDismiss={markNotificationRead}
          onViewAll={() => onNavigate?.(hasSecurityAlerts ? 'users' : hasReservationAlerts ? 'reservations' : 'inventory')}
          variant="widget"
          maxItems={5}
        />
      )}
    </div>
  )
}
