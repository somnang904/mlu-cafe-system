const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5634;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'reportstest_admin';
const ADMIN_PASS = 'Reports-Test-Only-9!';
const RUN = Date.now().toString(36);
const BULK_ORDERS = 1500;

let failures = 0;
let total = 0;

function check(label, condition, detail) {
  total += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    const extra = detail === undefined ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`;
    console.log(`FAIL  ${label}${extra}`);
  }
}

async function call(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const body = await res.json().catch(() => null);
  return body?.token || null;
}

async function run() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '', database: DB_NAME });
  const orderIds = [];
  let menuId = null;
  try {
    await conn.execute('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
    await conn.execute(
      `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
       VALUES ('Reports Test Admin', ?, ?, 'Admin', '[]', 1, 0)`,
      [ADMIN_USER, await bcrypt.hash(ADMIN_PASS, 10)],
    );
    const token = await login();
    check('admin login returns a token', !!token);
    if (!token) return;

    const [menu] = await conn.execute(
      "INSERT INTO menu_items (name, category, price) VALUES (?, 'Moved Category', 2.5)",
      [`E2E Report Item ${RUN}`],
    );
    menuId = menu.insertId;

    const insertOrder = async (invoice) => {
      const [r] = await conn.execute(
        "INSERT INTO orders (invoice_id, status, payment_method, subtotal, tax, total, updated_at) VALUES (?, 'Completed', 'Cash', 2.5, 0, 2.5, NOW())",
        [invoice],
      );
      orderIds.push(r.insertId);
      return r.insertId;
    };

    const snapId = await insertOrder(`E2E-SNAP-${RUN}`);
    await conn.execute(
      "INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal, item_category) VALUES (?, ?, 'Snap', 1, 2.5, 2.5, 'Original Category')",
      [snapId, menuId],
    );
    const goneId = await insertOrder(`E2E-GONE-${RUN}`);
    await conn.execute(
      "INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal, item_category) VALUES (?, NULL, 'Deleted Item', 1, 2.5, 2.5, 'Deleted Category')",
      [goneId],
    );
    const legacyId = await insertOrder(`E2E-LEGACY-${RUN}`);
    await conn.execute(
      "INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal, item_category) VALUES (?, ?, 'Legacy', 1, 2.5, 2.5, NULL)",
      [legacyId, menuId],
    );

    const rows = [];
    for (let i = 0; i < BULK_ORDERS; i += 1) rows.push([`E2E-BULK-${RUN}-${i}`, 'Completed', 'Cash', 1, 0, 1]);
    const [bulk] = await conn.query(
      'INSERT INTO orders (invoice_id, status, payment_method, subtotal, tax, total) VALUES ?',
      [rows],
    );
    const bulkIds = Array.from({ length: BULK_ORDERS }, (_, i) => bulk.insertId + i);
    orderIds.push(...bulkIds);
    await conn.query(
      'INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal) VALUES ?',
      [bulkIds.map((id) => [id, null, 'Bulk', 1, 1, 1])],
    );

    const all = await call('/orders/history?days=all', token);
    check('history days=all returns 200 with more than 1000 orders', all.status === 200 && Array.isArray(all.body) && all.body.length >= BULK_ORDERS + 3, all.status);
    const list = Array.isArray(all.body) ? all.body : [];
    const byInvoice = new Map(list.map((row) => [row.invoice_id, row]));
    const bulkWithItems = bulkIds.length && list.filter((row) => String(row.invoice_id).startsWith(`E2E-BULK-${RUN}`)).every((row) => row.items.length === 1);
    check('every bulk order across chunks keeps its item', bulkWithItems);
    check('line keeps its stored category after the menu item moved', byInvoice.get(`E2E-SNAP-${RUN}`)?.items?.[0]?.category === 'Original Category', byInvoice.get(`E2E-SNAP-${RUN}`)?.items);
    check('line of a deleted menu item keeps its stored category', byInvoice.get(`E2E-GONE-${RUN}`)?.items?.[0]?.category === 'Deleted Category', byInvoice.get(`E2E-GONE-${RUN}`)?.items);
    check('line without a stored category falls back to the menu category', byInvoice.get(`E2E-LEGACY-${RUN}`)?.items?.[0]?.category === 'Moved Category', byInvoice.get(`E2E-LEGACY-${RUN}`)?.items);
    const first = list.find((row) => row.invoice_id === `E2E-SNAP-${RUN}`);
    check('response shape keeps summary, items and payment fields', !!first && typeof first.summary === 'string' && first.payment_method === 'Cash' && first.target_id === 'takeout', first);
  } finally {
    if (orderIds.length) {
      await conn.query('DELETE FROM order_items WHERE order_id IN (?)', [orderIds]);
      await conn.query('DELETE FROM orders WHERE id IN (?)', [orderIds]);
    }
    if (menuId) await conn.query('DELETE FROM menu_items WHERE id = ?', [menuId]);
    await conn.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [ADMIN_USER]).catch(() => {});
    await conn.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
    await conn.end();
  }
}

run()
  .then(() => {
    console.log(`\n${total - failures}/${total} checks passed`);
    process.exit(failures ? 1 : 0);
  })
  .catch((error) => {
    console.error(`FAIL  unexpected error: ${error.stack || error.message}`);
    process.exit(1);
  });
