import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { expenseCategoryLabel } from '../utils/expenseCategories'
import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  Loader2,
  Receipt,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import Modal from '../components/common/Modal'
import FinanceBarChart from '../components/charts/FinanceBarChart'
import ExpenseTracker from '../components/finance/ExpenseTracker'
import { SalesFilterBar } from '../components/ui/SalesFilterBar'
import { usePOS } from '../context/POSContext'
import { useNotifications } from '../context/NotificationContext'
import { apiFetch, apiFetchDownload, saveBlobAsDownload } from '../services/apiClient'
import {
  DEFAULT_HISTORY_DAYS,
  buildDynamicMonthFilterOptions,
  filterCompletedOrders,
  filterOrdersByMonth,
  formatMonthLabel,
} from '../utils/salesHistoryAnalytics'
import {
  buildDailyProfitForMonth,
  buildMonthlyProfitChart,
  filterExpensesByMonth,
  summarizeExpenses,
  summarizeProfit,
} from '../utils/profitAnalytics'

const REPORT_EXPORT_SECTIONS = [
  { id: 'income', labelKey: 'reports.income' },
  { id: 'expenses', labelKey: 'reports.expenses' },
  { id: 'profit', labelKey: 'reports.netProfit' },
  { id: 'orders', labelKey: 'reports.ordersFulfilled' },
  { id: 'monthly', labelKey: 'reports.monthlyBreakdown' },
  { id: 'spending', labelKey: 'reports.spendingByCategory' },
]

function reportFileBase(selectedMonth) {
  return selectedMonth === 'all' ? 'Mlu_Report_All-Time' : `Mlu_Report_${selectedMonth}`
}

function sanitizeFileBase(value) {
  return String(value || '')
    .replace(/\.(xlsx|pdf)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function ReportExportDialog({ kind, selectedMonth, periodLabel, onClose }) {
  const { t } = useTranslation()
  const { pushBanner } = useNotifications()
  const [sections, setSections] = useState(() => REPORT_EXPORT_SECTIONS.map((section) => section.id))
  const [fileName, setFileName] = useState(() => reportFileBase(selectedMonth))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const allSelected = sections.length === REPORT_EXPORT_SECTIONS.length
  const fileBase = sanitizeFileBase(fileName)
  const canSave = sections.length > 0 && Boolean(fileBase) && !saving
  const extension = kind === 'excel' ? 'xlsx' : 'pdf'
  const title = kind === 'excel' ? t('reports.exportExcelTitle') : t('reports.exportPdfTitle')

  const saveLock = useRef(false)

  const toggleSection = (id) => {
    setSections((current) => (
      current.includes(id) ? current.filter((section) => section !== id) : [...current, id]
    ))
    setError('')
  }

  const confirmExport = async () => {
    if (!canSave || saveLock.current) return
    saveLock.current = true
    const fullName = `${fileBase}.${extension}`
    let handle = null
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: fullName,
          types: [
            extension === 'xlsx'
              ? {
                  description: 'Excel',
                  accept: {
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                  },
                }
              : {
                  description: 'PDF',
                  accept: { 'application/pdf': ['.pdf'] },
                },
          ],
        })
      } catch (pickerError) {
        if (pickerError?.name === 'AbortError') {
          saveLock.current = false
          return
        }
        handle = null
      }
    }

    setSaving(true)
    setError('')
    try {
      const ordered = REPORT_EXPORT_SECTIONS.map((section) => section.id).filter((id) => sections.includes(id))
      const { blob } = await apiFetchDownload(
        `/reports/export/${kind}`,
        fullName,
        { month: selectedMonth, sections: ordered.join(',') },
      )
      if (handle) {
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
      } else {
        saveBlobAsDownload(blob, fullName)
      }
      pushBanner({
        title: t('reports.exportSaved', { filename: fullName }),
        tone: 'success',
        durationMs: 4000,
      })
      onClose()
    } catch (exportError) {
      setError(exportError.message || t('reports.exportFailed'))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      titleId="report-export-title"
      onClose={onClose}
      closeLabel={t('a11y.closeModal')}
      dismissible={!saving}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn-secondary flex-1 py-2.5 text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={confirmExport}
            disabled={!canSave}
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2 py-2.5 text-sm"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? t('reports.exportPreparing') : t('reports.exportOk')}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{t('reports.exportSections')}</p>
          <button
            type="button"
            onClick={() => {
              setSections(allSelected ? [] : REPORT_EXPORT_SECTIONS.map((section) => section.id))
              setError('')
            }}
            className="shrink-0 text-sm font-semibold text-forest-700 hover:underline dark:text-forest-300"
          >
            {allSelected ? t('reports.clearAll') : t('reports.selectAll')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {REPORT_EXPORT_SECTIONS.map((section) => (
            <label key={section.id} className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-forest-600"
                checked={sections.includes(section.id)}
                onChange={() => toggleSection(section.id)}
              />
              <span className="min-w-0 break-words">{t(section.labelKey)}</span>
            </label>
          ))}
        </div>
        {sections.length === 0 ? (
          <p className="text-sm text-rose-700 dark:text-rose-300">{t('reports.exportNeedSection')}</p>
        ) : null}
        <label className="block text-sm">
          <span className="font-medium">{t('reports.fileName')}</span>
          <input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            className="input-field mt-1 w-full min-w-0 px-3 py-2 text-sm"
            maxLength={120}
          />
        </label>
        <p className="text-sm">
          <span className="text-muted">{t('reports.exportPeriod')}: </span>
          <span className="break-words font-medium">{periodLabel}</span>
        </p>
        {error ? <p className="break-words text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      </div>
    </Modal>
  )
}

function ReportExportCard({ selectedMonth, periodLabel }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState(null)
  const closeDialog = useCallback(() => setKind(null), [])

  return (
    <div className="surface-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h4 className="text-heading font-semibold">{t('reports.exportTitle')}</h4>
          <p className="text-muted mt-1 text-sm">{t('reports.exportHint')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setKind('excel')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-forest-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {t('reports.downloadReportExcel')}
          </button>
          <button
            type="button"
            onClick={() => setKind('pdf')}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-forest-600 px-4 py-2.5 text-sm font-semibold text-forest-700 transition hover:bg-forest-50 dark:text-forest-300 dark:hover:bg-forest-950/40"
          >
            <FileText className="h-4 w-4" />
            {t('reports.downloadReportPdf')}
          </button>
        </div>
      </div>
      {kind ? (
        <ReportExportDialog
          kind={kind}
          selectedMonth={selectedMonth}
          periodLabel={periodLabel}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  )
}

export default function ReportsAnalysis() {
  const { t } = useTranslation()
  const { salesHistory, loadSalesHistory } = usePOS()
  const [selectedMonth, setSelectedMonth] = useState('all')
  const [expenses, setExpenses] = useState([])
  const [expenseError, setExpenseError] = useState('')
  const [expenseTick, setExpenseTick] = useState(0)

  const completedSales = useMemo(
    () => filterCompletedOrders(salesHistory || []),
    [salesHistory],
  )

  const monthOptions = useMemo(
    () =>
      buildDynamicMonthFilterOptions(
        completedSales,
        expenses,
        new Date(),
        t,
        t('reports.allMonthsInRange'),
      ),
    [completedSales, expenses, t],
  )

  const loadExpenses = useCallback(async () => {
    setExpenseError('')
    try {
      const response = await apiFetch('/expenses?days=730')
      const data = await response.json().catch(() => [])
      if (!response.ok) throw new Error(data.message || t('reports.errors.loadExpenses'))
      setExpenses(Array.isArray(data) ? data : [])
    } catch (error) {
      setExpenseError(error.message || t('reports.errors.couldNotLoadExpenses'))
      setExpenses([])
    }
  }, [t])

  const refreshReportData = useCallback(() => {
    if (selectedMonth === 'all') {
      loadSalesHistory({ days: DEFAULT_HISTORY_DAYS })
    } else {
      loadSalesHistory({ month: selectedMonth })
    }
    loadExpenses()
  }, [selectedMonth, loadSalesHistory, loadExpenses])

  // Load once, then update only when an order is paid (this tab or another tab)
  useEffect(() => {
    refreshReportData()

    let channel
    try {
      channel = new BroadcastChannel('mlu-pos-sync')
      channel.onmessage = () => {
        refreshReportData()
      }
    } catch (_) {}

    window.addEventListener('mlu-order-completed', refreshReportData)

    return () => {
      window.removeEventListener('mlu-order-completed', refreshReportData)
      if (channel) channel.close()
    }
  }, [refreshReportData, expenseTick])

  const monthScopedSales = useMemo(
    () => filterOrdersByMonth(completedSales, selectedMonth),
    [completedSales, selectedMonth],
  )

  const monthScopedExpenses = useMemo(
    () => filterExpensesByMonth(expenses, selectedMonth),
    [expenses, selectedMonth],
  )

  const profit = useMemo(
    () => summarizeProfit(monthScopedSales, monthScopedExpenses),
    [monthScopedSales, monthScopedExpenses],
  )

  const expenseBreakdown = useMemo(
    () => summarizeExpenses(monthScopedExpenses),
    [monthScopedExpenses],
  )

  const chartData = useMemo(() => {
    if (selectedMonth === 'all') {
      return buildMonthlyProfitChart(completedSales, expenses, monthOptions)
    }
    return buildDailyProfitForMonth(completedSales, expenses, selectedMonth)
  }, [completedSales, expenses, monthOptions, selectedMonth])

  const chartLabel =
    selectedMonth === 'all'
      ? t('reports.monthlyChartTitle')
      : t('reports.dailyChartTitle', {
          month: formatMonthLabel(selectedMonth, t),
        })

  const incomeLabel = t('reports.income')
  const spendingLabel = t('reports.spending')

  const statCards = [
    {
      label: incomeLabel,
      value: `$${profit.revenue.toFixed(2)}`,
      icon: TrendingUp,
      accent: 'bg-forest-500',
    },
    {
      label: t('reports.expenses'),
      value: `$${profit.expenses.toFixed(2)}`,
      icon: TrendingDown,
      accent: 'bg-amber-700',
    },
    {
      label: t('reports.netProfit'),
      value: `$${profit.profit.toFixed(2)}`,
      icon: Wallet,
      accent: profit.profit >= 0 ? 'bg-blue-600' : 'bg-red-600',
    },
    {
      label: t('reports.ordersFulfilled'),
      value: profit.orders.toString(),
      icon: ShoppingBag,
      accent: 'bg-forest-700',
    },
  ]

  const categoryEntries = Object.entries(expenseBreakdown.byCategory).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-heading text-lg">{t('nav.reports')}</h3>
      </div>

      <div className="surface-card p-4">
        <SalesFilterBar
          selectedMonth={selectedMonth}
          onMonthChange={setSelectedMonth}
          monthOptions={monthOptions}
        />
      </div>

      <ReportExportCard
        selectedMonth={selectedMonth}
        periodLabel={
          selectedMonth === 'all'
            ? t('reports.allMonthsInRange')
            : formatMonthLabel(selectedMonth, t)
        }
      />

      {expenseError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {expenseError}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="surface-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-muted text-sm">{label}</p>
                <p className="text-heading mt-2 text-2xl font-bold tabular-nums">{value}</p>
              </div>
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent} text-white`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="surface-card overflow-hidden">
        <div className="border-b border-olive-100/60 px-6 py-4 dark:border-olive-800/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-100 dark:bg-forest-900/40">
              <BarChart3 className="h-5 w-5 text-forest-600 dark:text-forest-400" />
            </div>
            <h4 className="text-heading font-semibold">{chartLabel}</h4>
          </div>
        </div>
        <div className="h-80 p-4">
          <FinanceBarChart
            data={chartData}
            mode="income-spending"
            tickMode={selectedMonth === 'all' ? 'monthly' : 'daily'}
            incomeLabel={incomeLabel}
            spendingLabel={spendingLabel}
            emptyLabel={t('reports.noSalesYet')}
          />
        </div>
      </div>

      {categoryEntries.length > 0 ? (
        <div className="surface-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-950/40">
              <Receipt className="h-5 w-5 text-amber-800 dark:text-amber-300" />
            </div>
            <h4 className="text-heading font-semibold">{t('reports.spendingByCategory')}</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {categoryEntries.map(([category, amount]) => (
              <div key={category} className="surface-inset rounded-xl px-4 py-3">
                <p className="text-muted text-xs uppercase tracking-wider">
                  {expenseCategoryLabel(category, t)}
                </p>
                <p className="text-heading mt-1 text-lg font-semibold tabular-nums">${amount.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="surface-card p-5">
        <ExpenseTracker
          days={730}
          filterMonth={selectedMonth}
          onChanged={() => setExpenseTick((tick) => tick + 1)}
        />
      </div>
    </div>
  )
}
