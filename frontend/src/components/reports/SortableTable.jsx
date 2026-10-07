import { useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

/**
 * Small table for Reports. Columns: { key, label, align?, render?(row), sortValue?(row) }.
 * Columns with sortValue get a header button; click toggles descending/ascending.
 */
export default function SortableTable({ columns, rows, rowKey, initialSort = null, emptyLabel, limit = null }) {
  const [sort, setSort] = useState(initialSort)
  const sortColumn = columns.find((column) => column.key === sort?.key)

  const sorted = sortColumn?.sortValue
    ? [...rows].sort((a, b) => {
        const left = sortColumn.sortValue(a)
        const right = sortColumn.sortValue(b)
        const order = typeof left === 'string' ? left.localeCompare(right) : left - right
        return sort.dir === 'asc' ? order : -order
      })
    : rows
  const visible = limit ? sorted.slice(0, limit) : sorted

  const toggle = (key) => {
    setSort((current) => (current?.key === key
      ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' }))
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-sm">
        <thead>
          <tr className="table-head">
            {columns.map((column) => {
              const align = column.align === 'right' ? 'text-right' : 'text-left'
              const active = sort?.key === column.key
              const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-3 py-2.5 ${align}`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-forest-700 dark:hover:text-forest-300 ${
                        column.align === 'right' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      {column.label}
                      <Icon className={`h-3.5 w-3.5 ${active ? '' : 'opacity-40'}`} aria-hidden />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="table-divider">
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-muted px-3 py-8 text-center">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            visible.map((row, index) => (
              <tr key={rowKey(row, index)} className="table-row">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2.5 ${column.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {column.render ? column.render(row, index) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
