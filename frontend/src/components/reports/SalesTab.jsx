import { useTranslation } from 'react-i18next'
import { BarChart3, Clock, CreditCard, RotateCcw } from 'lucide-react'
import FinanceBarChart from '../charts/FinanceBarChart'
import PaymentMethodBadge from '../common/PaymentMethodBadge'
import PercentBars from './PercentBars'
import ReportCard, { ReportEmpty } from './ReportCard'
import SortableTable from './SortableTable'
import { formatDayKey, formatMoney } from './reportFormat'
import { paymentGroupLabel } from './paymentLabels'

function hourRange(hour) {
  return `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`
}

export default function SalesTab({ chart, hours, payments, refunds }) {
  const { t } = useTranslation()

  // Only the hours between the first and last sale, so the chart isn't mostly empty night hours.
  const active = hours.filter((entry) => entry.orders > 0)
  const firstHour = active.length ? active[0].hour : 0
  const lastHour = active.length ? active[active.length - 1].hour : -1
  const hourPoints = hours
    .filter((entry) => entry.hour >= firstHour && entry.hour <= lastHour)
    .map((entry) => ({
      label: String(entry.hour),
      fullLabel: `${hourRange(entry.hour)} · ${t('reports.ordersCount', { count: entry.orders })}`,
      revenue: entry.sales,
    }))
  const busiest = active.reduce((best, entry) => (!best || entry.orders > best.orders ? entry : best), null)

  const paymentRows = payments.map((row) => ({ ...row, label: paymentGroupLabel(row, t) }))
  const hasPayments = payments.some((row) => row.amount > 0)

  return (
    <div className="space-y-5">
      <ReportCard icon={BarChart3} title={t('reports.salesByDay')} bodyClassName="h-72 p-3 sm:p-4">
        <FinanceBarChart
          data={chart.points}
          mode="income-only"
          tickMode={chart.grain === 'month' ? 'monthly' : 'daily'}
          incomeLabel={t('reports.netSales')}
          emptyLabel={t('reports.noSalesInRange')}
        />
      </ReportCard>

      <div className="grid gap-5 lg:grid-cols-5">
        <ReportCard
          icon={Clock}
          title={t('reports.salesByHour')}
          className="lg:col-span-3"
          bodyClassName="p-3 sm:p-4"
          action={busiest ? (
            <span className="text-muted truncate text-xs sm:text-sm">
              {t('reports.busiestHour', { hours: hourRange(busiest.hour), count: busiest.orders })}
            </span>
          ) : null}
        >
          <div className="h-64">
            <FinanceBarChart
              data={hourPoints}
              mode="income-only"
              tickMode="daily"
              incomeLabel={t('reports.sales')}
              emptyLabel={t('reports.noSalesInRange')}
            />
          </div>
        </ReportCard>

        <ReportCard icon={CreditCard} title={t('reports.byPaymentMethod')} className="lg:col-span-2">
          {hasPayments ? (
            <PercentBars rows={paymentRows} detail={(row) => t('reports.ordersCount', { count: row.orders })} />
          ) : (
            <ReportEmpty>{t('reports.noSalesInRange')}</ReportEmpty>
          )}
        </ReportCard>
      </div>

      <ReportCard icon={RotateCcw} title={t('reports.refundsList')} bodyClassName="">
        <SortableTable
          rowKey={(row) => row.id}
          rows={refunds}
          initialSort={{ key: 'refundDate', dir: 'desc' }}
          emptyLabel={t('reports.noRefundsInRange')}
          columns={[
            {
              key: 'refundDate',
              label: t('reports.colRefundDate'),
              sortValue: (row) => row.refundDate || '',
              render: (row) => (row.refundDate ? formatDayKey(row.refundDate, t) : '—'),
            },
            { key: 'invoice', label: t('reports.colInvoice'), render: (row) => row.invoice || `#${row.id}` },
            {
              key: 'saleDate',
              label: t('reports.colSaleDate'),
              render: (row) => (row.saleDate ? formatDayKey(row.saleDate, t) : '—'),
            },
            { key: 'method', label: t('reports.colMethod'), render: (row) => <PaymentMethodBadge method={row.method} /> },
            { key: 'reason', label: t('reports.colReason'), render: (row) => row.reason || '—' },
            {
              key: 'amount',
              label: t('reports.colAmount'),
              align: 'right',
              sortValue: (row) => row.amount,
              render: (row) => formatMoney(-row.amount),
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
