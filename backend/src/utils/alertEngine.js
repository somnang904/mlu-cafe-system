const { STORE } = require('../config/store');
const { resolveStockStatus } = require('./inventorySchema');

const CACHE_TTL_MS = Number.parseInt(process.env.ALERTS_CACHE_TTL_MS, 10) || 20_000;
let alertsCache = { expiresAt: 0, payload: null };

function severityRank(severity) {
  return { critical: 0, warning: 1, info: 2 }[severity] ?? 9;
}

function nowIso() {
  return new Date().toISOString();
}

function makeAlert({
  id,
  category,
  severity,
  title,
  message,
  actionLabel,
  navigateTo,
  meta = {},
}) {
  return {
    id,
    category,
    severity,
    title,
    message,
    timestamp: nowIso(),
    action: {
      label: actionLabel,
      navigateTo,
    },
    meta,
  };
}

async function fetchInventoryForAlerts(db) {
  const [rows] = await db.execute(
    `
    SELECT
      id,
      item_name,
      category,
      stock_quantity,
      stock_status,
      max_stock,
      low_threshold,
      critical_threshold,
      unit_label,
      is_ingredient
    FROM inventory
    WHERE archived_at IS NULL OR is_ingredient = 1
    ORDER BY item_name ASC
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    itemName: row.item_name,
    item_name: row.item_name,
    category: row.category,
    stock: Number(row.stock_quantity ?? 0),
    stock_quantity: Number(row.stock_quantity ?? 0),
    stock_status: row.stock_status,
    stockStatus: row.stock_status,
    maxStock: Number(row.max_stock ?? 0),
    max_stock: Number(row.max_stock ?? 0),
    lowThreshold: row.low_threshold != null ? Number(row.low_threshold) : null,
    low_threshold: row.low_threshold != null ? Number(row.low_threshold) : null,
    criticalThreshold: row.critical_threshold != null ? Number(row.critical_threshold) : null,
    critical_threshold: row.critical_threshold != null ? Number(row.critical_threshold) : null,
    isIngredient: Boolean(Number(row.is_ingredient ?? 0)),
    is_ingredient: Boolean(Number(row.is_ingredient ?? 0)),
    unitLabel: row.unit_label || 'units',
    unit_label: row.unit_label || 'units',
    is_ingredient: row.is_ingredient,
    isIngredient: Boolean(row.is_ingredient),
  }));
}

function buildStockAlerts(inventory) {
  const alerts = [];

  for (const item of inventory) {
    const stock = Number(item.stock ?? item.stock_quantity ?? 0);
const lowThreshold = item.lowThreshold ?? (item.low_threshold != null ? Number(item.low_threshold) : null);
    const criticalThreshold = item.criticalThreshold ?? (item.critical_threshold != null ? Number(item.critical_threshold) : null);

    const status = resolveStockStatus(stock, lowThreshold, criticalThreshold);
    if (status === 'IN_STOCK') continue;

    const name = item.itemName || item.item_name;
    const unit = item.unitLabel || item.unit_label || item.unit || 'units';
const isOut = status === 'OUT_OF_STOCK';
    const isCrit = !isOut && criticalThreshold != null && stock <= criticalThreshold;
    const severity = (isOut || isCrit) ? 'critical' : 'warning';

    const thresholdDisplay = lowThreshold ?? criticalThreshold ?? 0;
    const message = isOut
      ? `${name} is out of stock (${stock} ${unit} on hand).`
      : isCrit
        ? `${name} is critically low (${stock} ${unit} remaining — threshold is ${criticalThreshold} ${unit}).`
        : `${name} is low on stock (${stock} ${unit} remaining — threshold is ${thresholdDisplay} ${unit}).`;

    const title = isOut
      ? `Out of stock: ${name}`
      : isCrit
        ? `Critically low: ${name}`
        : `Low stock: ${name}`;

    const isIngredient = Boolean(Number(item.isIngredient ?? item.is_ingredient ?? 0));
    const navigateTo = isIngredient ? 'inventory_ingredients' : 'inventory';
    const actionLabel = isIngredient
      ? `Add ${name} to Purchase Order`
      : `Restock ${name}`;

    alerts.push(
      makeAlert({
        id: `stock-${item.id}`,
        category: 'stock',
severity,
        title,
        message,
        actionLabel,
        navigateTo,
        meta: {
          inventoryId: item.id,
          stock,
          lowThreshold,
          criticalThreshold,
          isIngredient,
        },
      }),
    );
  }

  return alerts;
}

function summarize(alerts) {
  const counts = {
    total: alerts.length,
    critical: 0,
    warning: 0,
    info: 0,
    stock: 0,
    reservation: 0,
  };

  for (const alert of alerts) {
    if (alert.severity === 'critical') counts.critical += 1;
    else if (alert.severity === 'warning') counts.warning += 1;
    else if (alert.severity === 'info') counts.info += 1;

    if (alert.category === 'stock') counts.stock += 1;
    else if (alert.category === 'reservation') counts.reservation += 1;
  }

  return counts;
}

async function buildActiveAlerts(db, { bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && alertsCache.payload && alertsCache.expiresAt > now) {
    return alertsCache.payload;
  }

  const inventory = await fetchInventoryForAlerts(db);
  const alerts = buildStockAlerts(inventory).sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  );

  const payload = {
    generatedAt: nowIso(),
    store: {
      officialName: STORE.officialName,
      location: STORE.location,
    },
    counts: summarize(alerts),
    alerts,
  };

  alertsCache = { expiresAt: now + CACHE_TTL_MS, payload };
  return payload;
}

function clearAlertsCache() {
  alertsCache = { expiresAt: 0, payload: null };
}

module.exports = {
  buildActiveAlerts,
  clearAlertsCache,
  buildStockAlerts,
};
