import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function useFinanceChartTheme() {
  const { isDark } = useTheme()
  return useMemo(
    () => ({
      axis: isDark ? '#c2cbc5' : '#57534e',
      grid: isDark ? '#323b36' : '#d5efd5',
      income: isDark ? '#34d399' : '#059669',
      spending: isDark ? '#f59e0b' : '#c2410c',
      tooltipBg: isDark ? 'rgba(22, 26, 22, 0.96)' : 'rgba(255, 252, 248, 0.96)',
      tooltipBorder: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(90, 110, 70, 0.18)',
      tooltipMuted: isDark ? '#aeaeb2' : '#7a7168',
      cursor: isDark ? 'rgba(52, 211, 153, 0.12)' : 'rgba(16, 185, 129, 0.12)',
    }),
    [isDark],
  )
}

function formatMoneyTick(value) {
  const amount = Number(value) || 0
  if (amount >= 1000) return `$${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`
  return `$${Math.round(amount)}`
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`
}

function nullIfZero(value) {
  const amount = Number(value) || 0
  return amount === 0 ? null : amount
}

function FinanceTooltip({ active, payload, label, showSpending, incomeLabel, spendingLabel, theme }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  const title = point.fullLabel || label
  const income = Number(point.revenue || 0)
  const spending = Number(point.expenses || 0)
  const net = income - spending

  return (
    <div
      className="rounded-xl border px-3 py-2 text-sm shadow-lg"
      style={{
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
      }}
    >
      <p className="text-xs font-medium" style={{ color: theme.tooltipMuted }}>
        {title}
      </p>
      <p className="mt-1 font-semibold tabular-nums" style={{ color: theme.income }}>
        {incomeLabel}: {formatMoney(income)}
      </p>
      {showSpending ? (
        <>
          <p className="mt-0.5 font-semibold tabular-nums" style={{ color: theme.spending }}>
            {spendingLabel}: {formatMoney(spending)}
          </p>
          <p className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-zinc-100">
            Net: {formatMoney(net)}
          </p>
        </>
      ) : null}
    </div>
  )
}

/**
 * Shared finance bar chart for Reports (income + spending) and Dashboard (income only).
 */
export default function FinanceBarChart({
  data = [],
  mode = 'income-spending',
  tickMode = 'daily',
  incomeLabel = 'Income',
  spendingLabel = 'Spending',
  emptyLabel = 'No sales yet',
}) {
  const theme = useFinanceChartTheme()
  const showSpending = mode !== 'income-only'
  const wrapRef = useRef(null)
  const [chartWidth, setChartWidth] = useState(800)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width
      if (Number.isFinite(width) && width > 0) setChartWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const chartData = useMemo(
    () =>
      (Array.isArray(data) ? data : []).map((point) => ({
        ...point,
        revenue: nullIfZero(point.revenue),
        expenses: showSpending ? nullIfZero(point.expenses) : undefined,
      })),
    [data, showSpending],
  )

  const pointCount = Array.isArray(data) ? data.length : 0
  const hasValues = (Array.isArray(data) ? data : []).some(
    (point) => Number(point.revenue) > 0 || (showSpending && Number(point.expenses) > 0),
  )

  if (!hasValues) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted text-sm">{emptyLabel}</p>
      </div>
    )
  }

  // Week charts (≤7 days): always show every day label. Longer ranges may thin ticks on small screens.
  const showEveryDayTick = pointCount > 0 && pointCount <= 7
  const thinDailyTicks = tickMode === 'daily' && chartWidth <= 640 && !showEveryDayTick
  const xAngle = tickMode === 'monthly' ? -35 : 0
  const xHeight = tickMode === 'monthly' ? 56 : 32

  return (
    <div ref={wrapRef} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap="18%">
          <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: theme.axis, fontSize: showEveryDayTick ? 11 : 12 }}
            axisLine={{ stroke: theme.grid }}
            tickLine={false}
            interval={thinDailyTicks ? 4 : 0}
            angle={xAngle}
            textAnchor={tickMode === 'monthly' ? 'end' : 'middle'}
            height={xHeight}
            minTickGap={thinDailyTicks ? 8 : 0}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fill: theme.axis, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={formatMoneyTick}
          />
          <Tooltip
            cursor={{ fill: theme.cursor }}
            content={
              <FinanceTooltip
                showSpending={showSpending}
                incomeLabel={incomeLabel}
                spendingLabel={spendingLabel}
                theme={theme}
              />
            }
          />
          {showSpending ? (
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ paddingBottom: 8, fontSize: 12 }}
            />
          ) : null}
          <Bar
            dataKey="revenue"
            name={incomeLabel}
            fill={theme.income}
            radius={[6, 6, 0, 0]}
            maxBarSize={showSpending ? 28 : 36}
          />
          {showSpending ? (
            <Bar
              dataKey="expenses"
              name={spendingLabel}
              fill={theme.spending}
              radius={[6, 6, 0, 0]}
              maxBarSize={28}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
