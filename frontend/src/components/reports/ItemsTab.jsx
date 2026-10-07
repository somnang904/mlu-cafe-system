import { useTranslation } from 'react-i18next'
import { Layers, Snail, Trophy } from 'lucide-react'
import ReportCard from './ReportCard'
import SortableTable from './SortableTable'
import { formatMoney, formatPercent } from './reportFormat'
import { categoryStats } from '../../utils/reportAnalytics'

const LIST_SIZE = 10

/**
 * `items` are the sold items in the range; `menuItems` (available menu items) add the ones that sold
 * nothing, so "slowest" can show an item with 0 sales.
 */
export default function ItemsTab({ items, menuItems, itemName, categoryName }) {
  const { t } = useTranslation()

  const soldIds = new Set(items.map((item) => item.key))
  const unsold = menuItems
    .filter((menuItem) => menuItem.is_available !== false && !soldIds.has(`id:${menuItem.id}`))
    .map((menuItem) => ({
      key: `id:${menuItem.id}`,
      name: menuItem.name,
      category: menuItem.category || null,
      qty: 0,
      revenue: 0,
    }))

  const best = [...items].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, LIST_SIZE)
  const slowest = [...unsold, ...items]
    .sort((a, b) => a.qty - b.qty || a.revenue - b.revenue || a.name.localeCompare(b.name))
    .slice(0, LIST_SIZE)
  const categories = categoryStats(items)

  const itemColumns = [
    { key: 'rank', label: '#', render: (_row, index) => <span className="text-muted tabular-nums">{index + 1}</span> },
    {
      key: 'name',
      label: t('reports.colItem'),
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{itemName(row.name)}</span>
          <span className="text-muted block truncate text-xs">{categoryName(row.category)}</span>
        </span>
      ),
    },
    { key: 'qty', label: t('reports.colQty'), align: 'right' },
    { key: 'revenue', label: t('reports.colRevenue'), align: 'right', render: (row) => formatMoney(row.revenue) },
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportCard icon={Trophy} title={t('reports.bestSellers')} bodyClassName="">
          <SortableTable rowKey={(row) => row.key} rows={best} columns={itemColumns} emptyLabel={t('reports.noSalesInRange')} />
        </ReportCard>
        <ReportCard icon={Snail} title={t('reports.slowestSellers')} bodyClassName="">
          <SortableTable rowKey={(row) => row.key} rows={slowest} columns={itemColumns} emptyLabel={t('reports.noItemsYet')} />
        </ReportCard>
      </div>

      <ReportCard icon={Layers} title={t('reports.salesByCategory')} bodyClassName="">
        <SortableTable
          rowKey={(row) => row.category ?? '__none__'}
          rows={categories}
          initialSort={{ key: 'revenue', dir: 'desc' }}
          emptyLabel={t('reports.noSalesInRange')}
          columns={[
            {
              key: 'category',
              label: t('reports.colCategory'),
              sortValue: (row) => categoryName(row.category),
              render: (row) => categoryName(row.category),
            },
            { key: 'items', label: t('reports.colItems'), align: 'right', sortValue: (row) => row.items },
            { key: 'qty', label: t('reports.colQty'), align: 'right', sortValue: (row) => row.qty },
            {
              key: 'revenue',
              label: t('reports.colRevenue'),
              align: 'right',
              sortValue: (row) => row.revenue,
              render: (row) => formatMoney(row.revenue),
            },
            {
              key: 'percent',
              label: t('reports.colShare'),
              align: 'right',
              sortValue: (row) => row.percent,
              render: (row) => formatPercent(row.percent),
            },
          ]}
        />
      </ReportCard>
    </div>
  )
}
