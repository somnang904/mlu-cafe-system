export const LOW_STOCK_PORTIONS = 5

export function stockLevelOf(item) {
  const left = item?.stock_left
  if (left == null) return null
  const status = String(item.stock_status || '').toUpperCase()
  if (left <= 0 || status === 'OUT_OF_STOCK') return 'out'
  if (left <= LOW_STOCK_PORTIONS || status === 'LOW_STOCK') return 'low'
  return 'ok'
}
