import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  CircleAlert,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Repeat,
  Search,
  SquarePen,
  Trash2,
  Wallet,
} from 'lucide-react'
import ExpenseFormModal from '../components/expenses/ExpenseFormModal'
import ReceiptViewer from '../components/expenses/ReceiptViewer'
import ConfirmDeleteModal from '../components/ui/ConfirmDeleteModal'
import Tooltip from '../components/ui/Tooltip'
import PeriodSwitch from '../components/ui/PeriodSwitch'
import { ReportEmpty } from '../components/reports/ReportCard'
import { formatMoney, formatPercent } from '../components/reports/reportFormat'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationContext'
import { apiFetch, apiFetchDownload, saveBlobAsDownload } from '../services/apiClient'
import { categoryColorClass, expenseCategoryLabel } from '../utils/expenseCategories'
import { userHasPermission } from '../utils/permissions'
import { presetRange, toDayKey } from '../utils/reportRange'
import { formatKhr, usdToKhr } from '../utils/currency'
import { useExchangeRate } from '../hooks/useExchangeRate'

const PAGE_SIZE = 20
const PERIODS = ['all', 'day', 'month', 'year', 'custom']

/**
 * All = every expense (no dates), Day = today, Month = this month so far, Year = this year so far,
 * Custom = the chosen dates.
 */
function periodRange(period, customRange, today = new Date()) {
  const todayKey = toDayKey(today)
  if (period === 'all') return { from: null, to: null }
  if (period === 'day') return { from: todayKey, to: todayKey }
  if (period === 'year') return { from: `${todayKey.slice(0, 4)}-01-01`, to: todayKey }
  if (period === 'custom') return customRange
  return presetRange('thisMonth', today)
}

async function fetchJson(path, fallbackMessage) {
  const response = await apiFetch(path)
  const data = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(data?.message || fallbackMessage), { status: response.status })
  return data
}

function ExportMenu({ disabled, onExport, busy }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-secondary inline-flex h-10 items-center gap-1.5 px-3.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        {t('expenses.export')}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-xl dark:bg-zinc-900">
          {[
            { kind: 'excel', icon: FileSpreadsheet, label: t('reports.excel') },
            { kind: 'pdf', icon: FileText, label: t('reports.pdf') },
          ].map(({ kind, icon: Icon, label }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onExport(kind)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              <Icon className="h-4 w-4 text-forest-600 dark:text-forest-400" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function Expenses() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { pushBanner } = useNotifications()
  // The shop's USD → riel rate (set on the Dashboard), shared with the till.
  const exchangeRate = useExchangeRate()
  // The list (and edit/delete) needs Reports access, as on the server; Stock users can still add.
  const canView = userHasPermission(user, 'reports')

  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState(() => presetRange('thisMonth'))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const range = periodRange(period, customRange)

  const [categories, setCategories] = useState([])
  const [data, setData] = useState({ key: '', rows: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const requestRef = useRef(0)
  const dataKey = range.from ? `${range.from}|${range.to}` : 'all'

  const [formExpense, setFormExpense] = useState(undefined) // undefined: closed, null: add, object: edit
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [receiptExpense, setReceiptExpense] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetchJson('/expense-categories', t('expenses.errors.load'))
      .then((rows) => setCategories(Array.isArray(rows) ? rows : []))
      .catch(() => setCategories([]))
  }, [t])

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false)
      return
    }
    const requestId = ++requestRef.current
    setLoading(true)
    setLoadError('')
    try {
      const query = range.from ? `from=${range.from}&to=${range.to}` : 'days=all'
      const rows = await fetchJson(`/expenses?${query}`, t('expenses.errors.load'))
      if (requestId !== requestRef.current) return
      setData({ key: dataKey, rows: Array.isArray(rows) ? rows : [] })
    } catch (error) {
      if (requestId !== requestRef.current) return
      setLoadError(error.message || t('expenses.errors.couldNotLoad'))
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [canView, range.from, range.to, dataKey, t])

  useEffect(() => {
    load()
  }, [load])

  const categoryName = useCallback((name) => expenseCategoryLabel(name, t), [t])

  const matches = useCallback((expense) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return [expense.title, expense.vendor, expense.note, expense.category, categoryName(expense.category), expense.amount.toFixed(2), expense.amount_khr]
      .some((value) => String(value || '').toLowerCase().includes(query))
  }, [search, categoryName])

  const visible = useMemo(() => data.rows.filter(matches), [data, matches])

  const total = visible.reduce((sum, expense) => sum + expense.amount, 0)

  const byCategory = useMemo(() => {
    const map = new Map()
    for (const expense of visible) {
      const key = expense.category_id ?? expense.category
      const entry = map.get(key) || { key, name: expense.category, color: expense.category_color, amount: 0 }
      entry.amount += expense.amount
      map.set(key, entry)
    }
    const sum = [...map.values()].reduce((acc, entry) => acc + entry.amount, 0)
    return [...map.values()]
      .map((entry) => ({ ...entry, percent: sum ? (entry.amount / sum) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
  }, [visible])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const resetPage = (setter) => (value) => {
    setter(value)
    setPage(1)
  }

  const exportFile = async (kind) => {
    setExporting(true)
    const extension = kind === 'excel' ? 'xlsx' : 'pdf'
    const filename = range.from
      ? `Mlu_Expenses_${range.from}_to_${range.to}.${extension}`
      : `Mlu_Expenses_All-Time.${extension}`
    try {
      const { blob } = await apiFetchDownload(`/expenses/export/${kind}`, filename, {
        ...(range.from ? { from: range.from, to: range.to } : { period: 'all' }),
        ...(search.trim() ? { search: search.trim() } : {}),
      })
      saveBlobAsDownload(blob, filename)
      pushBanner({ title: t('reports.exportSaved', { filename }), tone: 'success', durationMs: 4000 })
    } catch (error) {
      pushBanner({ title: error.message || t('reports.exportFailed'), tone: 'error', durationMs: 5000 })
    } finally {
      setExporting(false)
    }
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    try {
      const response = await apiFetch(`/expenses/${target.id}`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || t('expenses.errors.delete'))
      pushBanner({ title: t('expenses.deleted'), tone: 'success', durationMs: 3000 })
      load()
    } catch (error) {
      pushBanner({ title: error.message || t('expenses.errors.delete'), tone: 'error', durationMs: 5000 })
    }
  }

  // The row shows the title (older expenses without one fall back to vendor, note or category).
  const describe = (expense) => expense.title || expense.vendor || expense.note || categoryName(expense.category)
  const ready = data.key === dataKey
  const todayKey = toDayKey(new Date())
  const filtered = Boolean(search.trim())

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center gap-3">
        <Wallet className="h-6 w-6 shrink-0 text-forest-600 dark:text-forest-400" aria-hidden />
        <h3 className="page-title">{t('nav.expenses')}</h3>
      </div>

      <div className="surface-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-[1.125rem] w-[1.125rem] -translate-y-1/2 text-slate-500 dark:text-zinc-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => resetPage(setSearch)(event.target.value)}
            placeholder={t('expenses.searchPlaceholder')}
            aria-label={t('expenses.searchPlaceholder')}
            className="input-field h-10 rounded-xl pl-11 shadow-sm"
            disabled={!canView}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu disabled={!canView} busy={exporting} onExport={exportFile} />
          <button
            type="button"
            onClick={() => setFormExpense(null)}
            disabled={!categories.length}
            className="btn-primary beam-border inline-flex h-10 items-center gap-1.5 px-4 text-sm shadow-[0_4px_14px_rgba(16,185,129,0.35)] disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('expenses.addExpense')}
          </button>
        </div>
      </div>
      </div>
      {/* Custom shows its start and end dates next to the switch. */}
      <div className="flex flex-wrap items-center gap-2">
        <PeriodSwitch
          value={period}
          onChange={resetPage(setPeriod)}
          options={PERIODS.map((id) => ({ id, label: t(`expenses.periods.${id}`) }))}
        />
        {period === 'custom' ? (
          <>
            <input
              type="date"
              value={customRange.from}
              max={todayKey}
              aria-label={t('reports.startDate')}
              onChange={(event) => {
                const from = event.target.value
                if (!from) return
                // Keep the range valid: moving the start past the end moves the end too.
                setCustomRange((current) => ({ from, to: current.to < from ? from : current.to }))
                setPage(1)
              }}
              className="input-field h-10 w-auto rounded-full px-3.5 text-sm shadow-sm"
            />
            <span className="text-muted" aria-hidden>–</span>
            <input
              type="date"
              value={customRange.to}
              min={customRange.from}
              aria-label={t('reports.endDate')}
              onChange={(event) => {
                const to = event.target.value
                if (!to) return
                setCustomRange((current) => ({ from: current.from > to ? to : current.from, to }))
                setPage(1)
              }}
              className="input-field h-10 w-auto rounded-full px-3.5 text-sm shadow-sm"
            />
          </>
        ) : null}
      </div>

      {!canView ? (
        <div className="surface-card flex items-start gap-3 p-5 text-sm">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <p>{t('expenses.listNeedsReports')}</p>
        </div>
      ) : null}

      {loadError ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </div>
      ) : null}

      {canView && !ready && !loadError ? (
        <div className="surface-card flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          {t('expenses.loading')}
        </div>
      ) : null}

      {canView && ready ? (
        <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading || undefined}>
          {/* One card: the total in dollars and riel, then how it splits by category. */}
          <section className="surface-card p-4 sm:p-5" aria-label={t('expenses.byCategory')}>
            <p className="text-muted text-sm">{t('expenses.cards.totalSpent')}</p>
            <p className="text-heading mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-2xl font-bold tabular-nums">
              <span>{formatMoney(total)}</span>
              <span className="font-normal text-slate-300 dark:text-zinc-600" aria-hidden>/</span>
              <span>{formatKhr(usdToKhr(total, exchangeRate))}</span>
            </p>
            {byCategory.length ? (
              <>
                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-zinc-700" role="img" aria-label={t('expenses.byCategory')}>
                  {byCategory.map((entry) => (
                    <span
                      key={entry.key}
                      className={`h-full ${categoryColorClass(entry.color)}`}
                      style={{ width: `${entry.percent}%` }}
                      title={`${categoryName(entry.name)} ${formatPercent(entry.percent)}`}
                    />
                  ))}
                </div>
                <ul className="mt-4 grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
                  {byCategory.map((entry) => (
                    <li key={entry.key} className="flex items-center gap-2 text-sm">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${categoryColorClass(entry.color)}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{categoryName(entry.name)}</span>
                      <span className="text-heading font-semibold tabular-nums">{formatMoney(entry.amount)}</span>
                      <span className="text-muted tabular-nums">/ {formatKhr(usdToKhr(entry.amount, exchangeRate))}</span>
                      <span className="text-muted w-14 text-right tabular-nums">{formatPercent(entry.percent)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <ReportEmpty>{filtered ? t('expenses.noMatches') : t('expenses.emptyPeriod')}</ReportEmpty>
            )}
          </section>

          <section className="surface-card overflow-hidden" aria-label={t('expenses.listTitle')}>
            <div className="overflow-x-auto">
              {/* Fixed column widths so the table lines up the same on every page of results. */}
              <table className="w-full min-w-[60rem] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-14" />
                  <col className="w-[19%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[11%]" />
                  <col className="w-[13%]" />
                  <col />
                  <col className="w-28" />
                </colgroup>
                <thead>
                  <tr className="table-head">
                    <th scope="col" className="px-4 py-3">#</th>
                    <th scope="col" className="px-4 py-3">{t('expenses.columns.title')}</th>
                    <th scope="col" className="px-4 py-3">{t('expenses.columns.vendor')}</th>
                    <th scope="col" className="px-4 py-3">{t('expenses.columns.category')}</th>
                    <th scope="col" className="px-4 py-3">{t('expenses.columns.amount')}</th>
                    <th scope="col" className="px-4 py-3">{t('expenses.columns.date')}</th>
                    <th scope="col" className="px-4 py-3">{t('expenses.columns.recordedBy')}</th>
                    <th scope="col" className="px-4 py-3 text-right">{t('expenses.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="table-divider">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-muted px-3 py-10 text-center">
                        {filtered ? t('expenses.noMatches') : t('expenses.emptyPeriod')}
                      </td>
                    </tr>
                  ) : pageRows.map((expense, index) => {
                    const title = describe(expense)
                    return (
                      <tr key={expense.id} className="table-row">
                        <td className="text-muted px-4 py-3 tabular-nums">{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                        <td className="px-4 py-3">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-medium">{title}</span>
                            {/* Older expenses may carry a receipt photo or repeat monthly. */}
                            {expense.has_receipt ? (
                              <Tooltip label={t('expenses.viewReceipt')}>
                                <button
                                  type="button"
                                  onClick={() => setReceiptExpense(expense)}
                                  aria-label={t('expenses.viewReceipt')}
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-forest-50 hover:text-forest-700 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300"
                                >
                                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              </Tooltip>
                            ) : null}
                            {expense.is_recurring ? (
                              <Tooltip label={t('expenses.repeatsMonthly')}>
                                <span tabIndex={0} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sky-600 dark:text-sky-400" aria-label={t('expenses.repeatsMonthly')}>
                                  <Repeat className="h-3.5 w-3.5" aria-hidden />
                                </span>
                              </Tooltip>
                            ) : null}
                          </span>
                        </td>
                        <td className="truncate px-4 py-3">
                          {expense.vendor}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${categoryColorClass(expense.category_color)}`} aria-hidden />
                            <span className="truncate">{categoryName(expense.category)}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums text-heading">
                          {/* Shown in the currency it was entered in. */}
                          {expense.currency === 'KHR' && expense.amount_khr ? formatKhr(expense.amount_khr) : formatMoney(expense.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{expense.expense_date}</td>
                        <td className="truncate px-4 py-3">{expense.created_by_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="flex items-center justify-end gap-0.5">
                            <Tooltip label={t('common.edit')} side="left">
                              <button
                                type="button"
                                onClick={() => setFormExpense(expense)}
                                aria-label={t('expenses.editExpense', { title })}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-forest-50 hover:text-forest-600 dark:text-zinc-400 dark:hover:bg-forest-950/50 dark:hover:text-forest-300"
                              >
                                <SquarePen className="h-4 w-4" aria-hidden />
                              </button>
                            </Tooltip>
                            <Tooltip label={t('common.delete')} side="left">
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(expense)}
                                aria-label={t('expenses.deleteExpense', { title })}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </Tooltip>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {visible.length > PAGE_SIZE ? (
              <nav aria-label={t('expenses.paginationLabel')} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3 text-sm">
                <span className="text-muted tabular-nums">
                  {t('expenses.pagination', {
                    from: (currentPage - 1) * PAGE_SIZE + 1,
                    to: Math.min(currentPage * PAGE_SIZE, visible.length),
                    total: visible.length,
                  })}
                </span>
                <span className="flex gap-2">
                  <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="btn-secondary min-h-8 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40">
                    {t('common.previous')}
                  </button>
                  <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="btn-secondary min-h-8 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40">
                    {t('common.next')}
                  </button>
                </span>
              </nav>
            ) : null}
          </section>
        </div>
      ) : null}

      {formExpense !== undefined ? (
        <ExpenseFormModal
          expense={formExpense}
          categories={categories}
          onClose={() => setFormExpense(undefined)}
          onSaved={() => {
            pushBanner({ title: t('expenses.saved'), tone: 'success', durationMs: 3000 })
            setFormExpense(undefined)
            load()
          }}
        />
      ) : null}

      <ConfirmDeleteModal
        isOpen={Boolean(deleteTarget)}
        title={t('expenses.deleteTitle')}
        itemName={deleteTarget ? `${describe(deleteTarget)} · ${formatMoney(deleteTarget.amount)}` : ''}
        message={deleteTarget?.is_recurring && deleteTarget.recurring_parent_id == null
          ? t('expenses.deleteRecurringMessage')
          : t('expenses.deleteMessage')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      {receiptExpense ? (
        <ReceiptViewer expense={receiptExpense} title={describe(receiptExpense)} onClose={() => setReceiptExpense(null)} />
      ) : null}
    </div>
  )
}
