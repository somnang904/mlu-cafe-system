import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  CalendarCheck,
  Eye,
  History,
  Loader2,
  Moon,
  Printer,
  RotateCcw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import KpiCard from './KpiCard'
import ReportCard, { ReportEmpty } from './ReportCard'
import Modal from '../common/Modal'
import ModalHeader from '../ui/ModalHeader'
import { formatMoney } from './reportFormat'
import { apiFetch } from '../../services/apiClient'

function formatTime(value, language) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(language === 'km' ? 'km-KH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function paymentLabel(row, t) {
  const method = String(row.method || '').toLowerCase()
  if (method === 'cash') return t('payment.methods.cash')
  return row.bank ? `${row.method} · ${row.bank}` : row.method
}

/** Dollars and riel as paid; days closed before that split was saved show the riel equivalent. */
function moneyAsPaid(total, usd, khr) {
  return usd == null ? { usd: total } : { paid: { usd, khr } }
}

/** first − the rest, or null when any part is missing (a day closed before the split was saved). */
function minus(first, ...rest) {
  if ([first, ...rest].some((value) => value == null)) return null
  return Math.round(rest.reduce((sum, value) => sum - value, first) * 100) / 100
}

/** The figures of one day: totals, how it was paid, items sold and spending. */
function DaySnapshot({ snapshot }) {
  const { t } = useTranslation()
  if (!snapshot) return <ReportEmpty>{t('reports.dayClose.noData')}</ReportEmpty>
  const { summary, payments = [], items = [], spending = [] } = snapshot
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label={t('reports.sales')} value={formatMoney(summary.revenue)} {...moneyAsPaid(summary.revenue, summary.salesUsd, summary.salesKhr)} icon={TrendingUp} accent="bg-forest-500" />
        <KpiCard
          label={t('reports.refunds')}
          value={formatMoney(-summary.refunds)}
          {...moneyAsPaid(-summary.refunds, summary.refundsUsd == null ? null : -summary.refundsUsd, -summary.refundsKhr)}
          hint={t('reports.refundsHint', { count: summary.refundOrders })}
          icon={RotateCcw}
          accent="bg-red-600"
        />
        <KpiCard label={t('reports.netSales')} value={formatMoney(summary.net)} {...moneyAsPaid(summary.net, minus(summary.salesUsd, summary.refundsUsd), minus(summary.salesKhr, summary.refundsKhr))} icon={BarChart3} accent="bg-emerald-700" />
        <KpiCard label={t('reports.expenses')} value={formatMoney(summary.expenses)} {...moneyAsPaid(summary.expenses, summary.expensesUsd, summary.expensesKhr)} icon={TrendingDown} accent="bg-orange-700" />
        <KpiCard label={t('reports.netProfit')} value={formatMoney(summary.profit)} {...moneyAsPaid(summary.profit, minus(summary.salesUsd, summary.refundsUsd, summary.expensesUsd), minus(summary.salesKhr, summary.refundsKhr, summary.expensesKhr))} icon={Wallet} accent={summary.profit < 0 ? 'bg-red-600' : 'bg-emerald-700'} />
        <KpiCard label={t('reports.ordersFulfilled')} value={String(summary.orders)} icon={ShoppingBag} accent="bg-emerald-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard icon={Wallet} title={t('reports.dayClose.payments')}>
          {payments.length ? (
            <table className="w-full text-sm">
              <tbody>
                {payments.map((row) => (
                  <tr key={`${row.method}-${row.bank}`} className="border-b border-border/60 last:border-0">
                    <td className="py-2">{paymentLabel(row, t)}</td>
                    <td className="text-muted py-2 text-right">{t('reports.dayClose.orderCount', { count: row.orders })}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <ReportEmpty>{t('reports.dayClose.noSales')}</ReportEmpty>}
        </ReportCard>

        <ReportCard icon={ShoppingBag} title={t('reports.dayClose.itemsSold')}>
          {items.length ? (
            <table className="w-full text-sm">
              <tbody>
                {items.map((row) => (
                  <tr key={row.name} className="border-b border-border/60 last:border-0">
                    <td className="py-2">{row.name}</td>
                    <td className="text-muted py-2 text-right tabular-nums">× {row.qty}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <ReportEmpty>{t('reports.dayClose.noSales')}</ReportEmpty>}
        </ReportCard>
      </div>

      {spending.length ? (
        <ReportCard icon={TrendingDown} title={t('reports.spendingByCategory')}>
          <table className="w-full text-sm">
            <tbody>
              {spending.map((row) => (
                <tr key={row.category} className="border-b border-border/60 last:border-0">
                  <td className="py-2">{row.category}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportCard>
      ) : null}
    </div>
  )
}

/**
 * End-of-day close: today's figures so far, a note, and "Close day" to save them; below, the days
 * already closed. A cashier closes their own sales and expenses; an admin the whole shop.
 */
export default function DayCloseTab() {
  const { t, i18n } = useTranslation()
  const [preview, setPreview] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [opened, setOpened] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [previewRes, listRes] = await Promise.all([apiFetch('/day-close/preview'), apiFetch('/day-close')])
      const previewData = await previewRes.json().catch(() => null)
      const listData = await listRes.json().catch(() => [])
      if (!previewRes.ok) throw new Error(previewData?.message || t('reports.dayClose.loadError'))
      setPreview(previewData)
      setNote(previewData.existing?.note || '')
      setHistory(Array.isArray(listData) ? listData : [])
    } catch (loadError) {
      setError(loadError.message || t('reports.dayClose.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const close = async () => {
    if (saving || !preview) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const response = await apiFetch('/day-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: preview.date, note }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || t('reports.dayClose.saveError'))
      setMessage(t('reports.dayClose.saved', { date: data.date }))
      await load()
    } catch (saveError) {
      setError(saveError.message || t('reports.dayClose.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const openClose = async (id) => {
    const response = await apiFetch(`/day-close/${id}`)
    const data = await response.json().catch(() => null)
    if (response.ok) setOpened(data)
    else setError(data?.message || t('reports.dayClose.loadError'))
  }

  if (loading && !preview) {
    return (
      <div className="surface-card flex min-h-64 items-center justify-center gap-2 text-sm text-slate-500 dark:text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        {t('reports.loading')}
      </div>
    )
  }

  const existing = preview?.existing
  const scopeText = preview?.scope === 'shop' ? t('reports.dayClose.scopeShop') : t('reports.dayClose.scopeOwn')

  return (
    <div className="space-y-5">
      <ReportCard
        icon={Moon}
        title={t('reports.dayClose.title', { date: preview?.date || '' })}
        action={existing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CalendarCheck className="h-3.5 w-3.5" aria-hidden />
            {t('reports.dayClose.closedAt', { time: formatTime(existing.updated_at || existing.closed_at, i18n.language) })}
          </span>
        ) : null}
      >
        <p className="text-muted mb-4 text-sm">{scopeText}</p>
        <DaySnapshot snapshot={preview?.snapshot} />

        <div className="mt-5 space-y-2">
          <label htmlFor="day-close-note" className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            {t('reports.dayClose.note')}
          </label>
          <textarea
            id="day-close-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('reports.dayClose.notePlaceholder')}
            className="input-field w-full resize-y rounded-xl px-3 py-2 text-sm"
          />
          {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {message ? <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
              {existing ? t('reports.dayClose.closeAgain') : t('reports.dayClose.close')}
            </button>
            <p className="text-muted text-xs">{existing ? t('reports.dayClose.closeAgainHint') : t('reports.dayClose.closeHint')}</p>
          </div>
        </div>
      </ReportCard>

      <ReportCard icon={History} title={t('reports.dayClose.history')} bodyClassName="p-0">
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted border-b border-border/70 text-left text-xs uppercase tracking-wider">
                  <th className="px-4 py-2">{t('reports.dayClose.date')}</th>
                  <th className="px-4 py-2">{t('reports.dayClose.closedBy')}</th>
                  <th className="px-4 py-2 text-right">{t('reports.netSales')}</th>
                  <th className="px-4 py-2 text-right">{t('reports.ordersFulfilled')}</th>
                  <th className="px-4 py-2">{t('reports.dayClose.closedTime')}</th>
                  <th className="px-4 py-2" aria-label={t('reports.dayClose.view')} />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 font-semibold">{row.date}</td>
                    <td className="px-4 py-2">
                      {row.user_name}
                      <span className="text-muted ml-1 text-xs">({row.scope === 'shop' ? t('reports.dayClose.shop') : t('reports.dayClose.own')})</span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatMoney(row.net_sales)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.orders}</td>
                    <td className="text-muted px-4 py-2">{formatTime(row.updated_at || row.closed_at, i18n.language)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openClose(row.id)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-forest-700 hover:bg-forest-100 dark:text-forest-300 dark:hover:bg-forest-900/40"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden /> {t('reports.dayClose.view')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <ReportEmpty>{t('reports.dayClose.noHistory')}</ReportEmpty>}
      </ReportCard>

      {opened ? (
        <Modal
          title={t('reports.dayClose.title', { date: opened.date })}
          titleId="day-close-view-title"
          header={<ModalHeader icon={Moon} titleId="day-close-view-title" title={t('reports.dayClose.title', { date: opened.date })} />}
          onClose={() => setOpened(null)}
          closeLabel={t('a11y.closeModal')}
          maxWidth="max-w-4xl"
          footer={(
            <button type="button" onClick={() => window.print()} className="btn-secondary inline-flex flex-1 items-center justify-center gap-2 py-2.5 text-sm">
              <Printer className="h-4 w-4" aria-hidden /> {t('reports.dayClose.print')}
            </button>
          )}
        >
          <p className="text-muted mb-4 text-sm">
            {t('reports.dayClose.closedByLine', {
              name: opened.user_name,
              scope: opened.scope === 'shop' ? t('reports.dayClose.shop') : t('reports.dayClose.own'),
              time: formatTime(opened.updated_at || opened.closed_at, i18n.language),
            })}
          </p>
          <DaySnapshot snapshot={opened.snapshot} />
          {opened.note ? (
            <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2 text-sm dark:bg-zinc-800/60">
              <span className="font-semibold">{t('reports.dayClose.note')}: </span>{opened.note}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  )
}
