const STATUS_RANK = { IN_STOCK: 0, LOW_STOCK: 1, OUT_OF_STOCK: 2 }

function portionsFor(link) {
  const perUnit = Number(link.quantity_per_unit)
  const onHand = Math.max(0, Number(link.stock_quantity))
  if (!(perUnit > 0)) return Infinity
  return Math.floor(onHand / perUnit + 1e-9)
}

function statusFor(link, portions) {
  if (portions <= 0) return 'OUT_OF_STOCK'
  const stored = String(link.stock_status || '').toUpperCase()
  return STATUS_RANK[stored] != null ? stored : 'IN_STOCK'
}

function summarizeMenuStock(links) {
  const byMenu = new Map()
  for (const link of links) {
    const menuId = Number(link.menu_item_id)
    const portions = portionsFor(link)
    const status = statusFor(link, portions)
    const current = byMenu.get(menuId)
    if (!current) {
      byMenu.set(menuId, { portions, status })
      continue
    }
    current.portions = Math.min(current.portions, portions)
    if (STATUS_RANK[status] > STATUS_RANK[current.status]) current.status = status
  }

  const summary = new Map()
  for (const [menuId, { portions, status }] of byMenu) {
    summary.set(menuId, {
      stock_left: Number.isFinite(portions) ? portions : null,
      stock_status: status,
    })
  }
  return summary
}

async function loadMenuStock(db) {
  const [links] = await db.execute(
    `SELECT l.menu_item_id, l.quantity_per_unit, i.stock_quantity, i.stock_status
     FROM menu_item_stock_links l
     JOIN inventory i ON i.id = l.inventory_id`,
  )
  return summarizeMenuStock(links)
}

module.exports = { summarizeMenuStock, loadMenuStock }
