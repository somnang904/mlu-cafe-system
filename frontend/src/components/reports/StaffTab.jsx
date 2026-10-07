import { useTranslation } from 'react-i18next'
import { Info, UserRound } from 'lucide-react'
import ReportCard from './ReportCard'
import SortableTable from './SortableTable'
import { formatMoney } from './reportFormat'

/** Orders each staff member took and what they sold. Orders from before staff were recorded group as "Not recorded". */
export default function StaffTab({ staff }) {
  const { t } = useTranslation()
  const hasUnrecorded = staff.some((row) => !row.name)

  return (
    <div className="space-y-4">
      <ReportCard icon={UserRound} title={t('reports.staffPerformance')} bodyClassName="">
        <SortableTable
          rowKey={(row) => row.key}
          rows={staff}
          initialSort={{ key: 'sales', dir: 'desc' }}
          emptyLabel={t('reports.noSalesInRange')}
          columns={[
            {
              key: 'name',
              label: t('reports.colStaff'),
              sortValue: (row) => row.name || '',
              render: (row) => (row.name
                ? <span className="font-medium">{row.name}</span>
                : <span className="text-muted italic">{t('reports.staffNotRecorded')}</span>),
            },
            { key: 'orders', label: t('reports.colOrders'), align: 'right', sortValue: (row) => row.orders },
            {
              key: 'sales',
              label: t('reports.colSales'),
              align: 'right',
              sortValue: (row) => row.sales,
              render: (row) => formatMoney(row.sales),
            },
            {
              key: 'average',
              label: t('reports.colAverage'),
              align: 'right',
              sortValue: (row) => row.average,
              render: (row) => formatMoney(row.average),
            },
            {
              key: 'refunds',
              label: t('reports.refunds'),
              align: 'right',
              sortValue: (row) => row.refunds,
              render: (row) => (row.refunds ? formatMoney(-row.refunds) : '—'),
            },
          ]}
        />
      </ReportCard>
      {hasUnrecorded ? (
        <p className="text-muted flex items-start gap-1.5 px-1 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('reports.staffNotRecordedHint')}
        </p>
      ) : null}
    </div>
  )
}
