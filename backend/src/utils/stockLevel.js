// Stock level used by the notification alerts. Mirrors frontend/src/utils/stockStatus.js
// (the Items page, badges and tabs); keep LOW_THRESHOLD the same in both.

/** An item is Low once it holds this share of its maximum or less (0.3 = 30%). */
const LOW_THRESHOLD = 0.3

/** 'out' when empty, 'low' at or below LOW_THRESHOLD × max, otherwise 'in'. */
function stockLevel(stock, maxStock) {
  const qty = Number(stock)
  const max = Number(maxStock)
  if (!Number.isFinite(qty) || qty <= 0) return 'out'
  if (Number.isFinite(max) && qty <= LOW_THRESHOLD * max) return 'low'
  return 'in'
}

module.exports = { LOW_THRESHOLD, stockLevel }
