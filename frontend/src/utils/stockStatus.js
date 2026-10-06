/**
 * Stock status for inventory items: the one place the frontend decides In stock / Low / Out of stock.
 * The list, badges, progress bars, status tabs and sorting all read from here.
 * The backend alert engine mirrors LOW_THRESHOLD in backend/src/utils/stockLevel.js; change both together.
 */

/** An item is Low once it holds this share of its maximum or less (0.3 = 30%). */
export const LOW_THRESHOLD = 0.3

export const STOCK_STATUS = {
  OUT: 'out',
  LOW: 'low',
  IN: 'in',
}

/** Most urgent first: Out of stock, Low, In stock. */
export const STOCK_STATUS_ORDER = [STOCK_STATUS.OUT, STOCK_STATUS.LOW, STOCK_STATUS.IN]

export function getStockStatus(item) {
  const stock = Number(item?.stock_quantity)
  const max = Number(item?.max_stock)
  if (!Number.isFinite(stock) || stock <= 0) return STOCK_STATUS.OUT
  if (Number.isFinite(max) && stock <= LOW_THRESHOLD * max) return STOCK_STATUS.LOW
  return STOCK_STATUS.IN
}

/** Share of the maximum on hand, 0–1 (0 when empty or the maximum is unknown). */
export function getStockRatio(item) {
  const stock = Number(item?.stock_quantity)
  const max = Number(item?.max_stock)
  if (!Number.isFinite(stock) || stock <= 0 || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(1, stock / max)
}

export function stockStatusRank(status) {
  const rank = STOCK_STATUS_ORDER.indexOf(status)
  return rank === -1 ? STOCK_STATUS_ORDER.length : rank
}
