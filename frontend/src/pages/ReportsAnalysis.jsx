import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileBarChart, Loader2 } from 'lucide-react'
import ReportFilterBar from '../components/reports/ReportFilterBar'
import ReportExportDialog from '../components/reports/ReportExportDialog'
import OverviewTab from '../components/reports/OverviewTab'
import SalesTab from '../components/reports/SalesTab'
import ItemsTab from '../components/reports/ItemsTab'
import StaffTab from '../components/reports/StaffTab'
import { chartLabels, formatRangeLabel } from '../components/reports/reportFormat'
import { apiFetch } from '../services/apiClient'
import { menuCategoryLabel } from '../utils/menuCategoryLabel'
import { translateMenuName } from '../utils/menuNameTranslations'
import {
  buildRangeChart,
  hourlySales,
  itemStats,
  paymentBreakdown,
  refundsInRange,
  staffStats,
  summarizeRange,
} from '../utils/reportAnalytics'
import { comparisonRange, dayCount, isDayKey, monthRange, presetRange } from '../utils/reportRange'
import { normalizeOrderDate } from '../utils/salesHistoryAnalytics'

const TABS = ['overview', 'sales', 'items', 'staff']
const MAX_RANGE_DAYS = 800

async function fetchJson(path, fallbackMessage) {
  const response = await apiFetch(path)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.message || fallbackMessage)
  return data
}

function validateRange(range, t) {
  if (!isDayKey(range.from) || !isDayKey(range.to)) return t('reports.rangeInvalid')
  if (range.from > range.to) return t('reports.rangeStartAfterEnd')
  if (dayCount(range.from, range.to) > MAX_RANGE_DAYS) return t('reports.rangeTooLong')
  return ''
}

export default function ReportsAnalysis({ onNavigate }) {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState('overview')
  const [preset, setPreset] = useState('month')
  const [customRange, setCustomRange] = useState(() => presetRange('month'))
  const [compare, setCompare] = useState(false)
  const [exportKind, setExportKind] = useState(null)

  // All = every sale and expense; there is nothing before it to compare with.
  const isAll = preset === 'all'
  const comparing = compare && !isAll
  const selectedRange = preset === 'custom' ? customRange : presetRange(isAll ? 'day' : preset)
  const rangeError = preset === 'custom' ? validateRange(customRange, t) : ''
  // Day → yesterday, Week → last week, Month → last month, Year → last year, Custom → the days before.
  const previous = useMemo(
    () => (rangeError || isAll ? null : comparisonRange(preset, selectedRange.from, selectedRange.to)),
    [preset, isAll, selectedRange.from, selectedRange.to, rangeError],
  )

  // Orders and expenses for the range (plus the previous period while compare is on).
  const [data, setData] = useState({ key: '', orders: [], expenses: [], previousOrders: [], previousExpenses: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const requestRef = useRef(0)
  const dataKey = isAll ? 'all' : `${selectedRange.from}|${selectedRange.to}|${comparing ? 1 : 0}`

  const load = useCallback(async () => {
    if (rangeError) return
    const requestId = ++requestRef.current
    setLoading(true)
    setLoadError('')
    const query = (from, to) => `from=${from}&to=${to}`
    const current = isAll ? 'days=all' : query(selectedRange.from, selectedRange.to)
    try {
      const [orders, expenses, previousOrders, previousExpenses] = await Promise.all([
        fetchJson(`/orders/history?${current}`, t('reports.errors.loadSales')),
        fetchJson(`/expenses?${current}`, t('reports.errors.loadExpenses')),
        comparing ? fetchJson(`/orders/history?${query(previous.from, previous.to)}`, t('reports.errors.loadSales')) : [],
        comparing ? fetchJson(`/expenses?${query(previous.from, previous.to)}`, t('reports.errors.loadExpenses')) : [],
      ])
      if (requestId !== requestRef.current) return
      setData({
        key: dataKey,
        orders: Array.isArray(orders) ? orders : [],
        expenses: Array.isArray(expenses) ? expenses : [],
        previousOrders: Array.isArray(previousOrders) ? previousOrders : [],
        previousExpenses: Array.isArray(previousExpenses) ? previousExpenses : [],
      })
    } catch (error) {
      if (requestId !== requestRef.current) return
      setLoadError(error.message || t('reports.errors.loadSales'))
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [rangeError, isAll, selectedRange.from, selectedRange.to, comparing, previous, dataKey, t])

  // Reload when the selection changes, and when an order is paid (this tab or another one).
  useEffect(() => {
    load()
    let channel
    try {
      channel = new BroadcastChannel('mlu-pos-sync')
      channel.onmessage = () => load()
    } catch {
      // BroadcastChannel is missing in some browsers; cross-tab sync is optional.
    }
    window.addEventListener('mlu-order-completed', load)
    return () => {
      window.removeEventListener('mlu-order-completed', load)
      if (channel) channel.close()
    }
  }, [load])

  // Menu items (for items that sold nothing) and the Menu page's category labels.
  const [menuItems, setMenuItems] = useState([])
  const [categoryLabels, setCategoryLabels] = useState({})
  useEffect(() => {
    let cancelled = false
    fetchJson('/menu', '')
      .then((items) => !cancelled && Array.isArray(items) && setMenuItems(items))
      .catch(() => {})
    fetchJson('/menu/categories', '')
      .then((result) => !cancelled && setCategoryLabels(result?.labels || {}))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const ready = data.key === dataKey
  // For All, the range runs from the first sale or expense to today.
  const range = useMemo(() => {
    if (!isAll) return selectedRange
    const today = presetRange('day').to
    const first = [
      ...data.orders.map((order) => normalizeOrderDate(order)),
      ...data.expenses.map((expense) => String(expense.expense_date || '').slice(0, 10)),
    ].filter(Boolean).sort()[0]
    return { from: first && first < today ? first : today, to: today }
    // selectedRange is rebuilt each render; its from/to are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAll, data, selectedRange.from, selectedRange.to])
  const figures = useMemo(() => {
    const { orders, expenses } = data
    const items = itemStats(orders, range.from, range.to)
    return {
      summary: summarizeRange(orders, expenses, range.from, range.to),
      previous: comparing && previous ? summarizeRange(data.previousOrders, data.previousExpenses, previous.from, previous.to) : null,
      chart: buildRangeChart(orders, expenses, range.from, range.to, (key, grain) => chartLabels(key, grain, t)),
      payments: paymentBreakdown(orders, range.from, range.to),
      items,
      hours: hourlySales(orders, range.from, range.to),
      refunds: refundsInRange(orders, range.from, range.to),
      staff: staffStats(orders, range.from, range.to),
    }
  }, [data, range.from, range.to, comparing, previous, t])

  const rangeLabel = rangeError ? '' : isAll ? t('reports.allTime') : formatRangeLabel(range.from, range.to, t)
  const compareLabel = previous ? formatRangeLabel(previous.from, previous.to, t) : ''
  const itemName = (name) => translateMenuName(name, i18n.language, t)
  const categoryName = (category) => menuCategoryLabel(category, t, categoryLabels)

  const changePreset = (next) => {
    if (next === 'custom' && preset !== 'custom') setCustomRange(isAll ? presetRange('month') : range)
    setPreset(next)
  }

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center gap-3">
        <FileBarChart className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
        <h3 className="page-title">{t('nav.reports')}</h3>
      </div>

      <div role="tablist" aria-label={t('reports.tabsLabel')} className="flex flex-wrap gap-2">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`reports-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="reports-tab-panel"
            onClick={() => setTab(id)}
            className={`tab-pill shrink-0 rounded-xl px-4 shadow-sm ${tab === id ? 'tab-pill-active' : 'tab-pill-inactive'}`}
          >
            {t(`reports.tabs.${id}`)}
          </button>
        ))}
      </div>

      <ReportFilterBar
        preset={preset}
        onPresetChange={changePreset}
        range={range}
        onCustomRangeChange={setCustomRange}
        onMonthPick={(monthKey) => setCustomRange(monthRange(monthKey))}
        compare={compare}
        onCompareChange={setCompare}
        rangeLabel={comparing && compareLabel ? t('reports.rangeVs', { range: rangeLabel, previous: compareLabel }) : rangeLabel}
        rangeError={rangeError}
        onExport={setExportKind}
      />

      {loadError ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </div>
      ) : null}

      <div id="reports-tab-panel" role="tabpanel" aria-labelledby={`reports-tab-${tab}`} aria-busy={loading || undefined}>
        {rangeError ? null : !ready ? (
          <div className="surface-card flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            {t('reports.loading')}
          </div>
        ) : (
          // Keep the last figures on screen while a refresh loads, just dimmed.
          <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {tab === 'overview' ? (
              <OverviewTab
                summary={figures.summary}
                previous={figures.previous}
                compare={comparing}
                chart={figures.chart}
                payments={figures.payments}
                items={figures.items}
                itemName={itemName}
                onOpenExpenses={() => onNavigate?.('inventory_expenses')}
                onViewAllItems={() => setTab('items')}
              />
            ) : null}
            {tab === 'sales' ? (
              <SalesTab chart={figures.chart} hours={figures.hours} payments={figures.payments} refunds={figures.refunds} />
            ) : null}
            {tab === 'items' ? (
              <ItemsTab items={figures.items} menuItems={menuItems} itemName={itemName} categoryName={categoryName} />
            ) : null}
            {tab === 'staff' ? <StaffTab staff={figures.staff} /> : null}
          </div>
        )}
      </div>

      {exportKind ? (
        <ReportExportDialog
          kind={exportKind}
          from={range.from}
          to={range.to}
          allTime={isAll}
          compare={comparing}
          periodLabel={rangeLabel}
          compareLabel={compareLabel}
          compareRange={previous}
          onClose={() => setExportKind(null)}
        />
      ) : null}
    </div>
  )
}
