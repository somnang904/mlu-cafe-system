import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  ChevronRight,
  CreditCard,
  RotateCcw,
  ShoppingBag,
  Trophy,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import FinanceBarChart from '../charts/FinanceBarChart'
import KpiCard from './KpiCard'
import PercentBars from './PercentBars'
import ReportCard, { ReportEmpty } from './ReportCard'
import SortableTable from './SortableTable'
import { formatMoney } from './reportFormat'
import { paymentGroupLabel } from './paymentLabels'
import { percentChange } from '../../utils/reportAnalytics'

const TOP_ITEMS = 5

export default function OverviewTab({ summary, previous, compare, chart, payments, items, itemName, onOpenExpenses, onViewAllItems }) {
  const { t } = useTranslation()
  const change = (key) => (compare && previous ? percentChange(summary[key], previous[key]) : null)
  const topItems = [...items].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, TOP_ITEMS)
  const paymentRows = payments.map((row) => ({ ...row, label: paymentGroupLabel(row, t) }))
  const hasPayments = payments.some((row) => row.amount > 0)

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label={t('reports.sales')}
          value={formatMoney(summary.sales)}
          icon={TrendingUp}
          accent="bg-forest-500"
          compare={compare}
          change={change('sales')}
        />
        <KpiCard
          label={t('reports.refunds')}
          value={formatMoney(-summary.refunds)}
          hint={t('reports.refundsHint', { count: summary.refundOrders })}
          icon={RotateCcw}
          accent="bg-red-600"
          compare={compare}
          change={change('refunds')}
          goodWhen="down"
        />
        <KpiCard
          label={t('reports.netSales')}
          value={formatMoney(summary.net)}
          hint={t('reports.netSalesHint')}
          icon={BarChart3}
          accent="bg-forest-600"
          compare={compare}
          change={change('net')}
        />
        <KpiCard
          label={t('reports.expenses')}
          value={formatMoney(summary.expenses)}
          hint={t('reports.openExpensesHint')}
          icon={TrendingDown}
          accent="bg-amber-700"
          compare={compare}
          change={change('expenses')}
          goodWhen="down"
          onClick={onOpenExpenses}
        />
        <KpiCard
          label={t('reports.netProfit')}
          value={formatMoney(summary.profit)}
          hint={t('reports.netProfitHint')}
          icon={Wallet}
          accent={summary.profit >= 0 ? 'bg-forest-700' : 'bg-red-600'}
          compare={compare}
          change={change('profit')}
        />
        <KpiCard
          label={t('reports.ordersFulfilled')}
          value={String(summary.orders)}
          icon={ShoppingBag}
          accent="bg-forest-700"
          compare={compare}
          change={change('orders')}
        />
      </div>

      <ReportCard icon={BarChart3} title={t('reports.incomeVsSpending')} bodyClassName="h-80 p-3 sm:p-4">
        <FinanceBarChart
          data={chart.points}
          mode="income-spending"
          tickMode={chart.grain === 'month' ? 'monthly' : 'daily'}
          incomeLabel={t('reports.netSales')}
          spendingLabel={t('reports.spending')}
          emptyLabel={t('reports.noDataInRange')}
        />
      </ReportCard>

      <div className="grid gap-5 lg:grid-cols-5">
        <ReportCard icon={CreditCard} title={t('reports.byPaymentMethod')} className="lg:col-span-2">
          {hasPayments ? (
            <PercentBars rows={paymentRows} detail={(row) => t('reports.ordersCount', { count: row.orders })} />
          ) : (
            <ReportEmpty>{t('reports.noSalesInRange')}</ReportEmpty>
          )}
        </ReportCard>

        <ReportCard
          icon={Trophy}
          title={t('reports.topSellingItems')}
          className="lg:col-span-3"
          bodyClassName=""
          action={(
            <button
              type="button"
              onClick={onViewAllItems}
              className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-forest-700 hover:underline dark:text-forest-300"
            >
              {t('reports.viewAll')}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        >
          <SortableTable
            rowKey={(row) => row.key}
            rows={topItems}
            emptyLabel={t('reports.noSalesInRange')}
            columns={[
              { key: 'name', label: t('reports.colItem'), render: (row) => itemName(row.name) },
              { key: 'qty', label: t('reports.colQty'), align: 'right' },
              { key: 'revenue', label: t('reports.colRevenue'), align: 'right', render: (row) => formatMoney(row.revenue) },
            ]}
          />
        </ReportCard>
      </div>
    </div>
  )
}
