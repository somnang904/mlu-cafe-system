const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5631;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'ordaudit_admin';
const ADMIN_PASS = 'Order-Audit-Only-9!';
const RUN = Date.now().toString(36);
const MENU_ID = 97;
const MENU_NAME = 'Espresso';

let failures = 0;
let total = 0;

function check(label, condition, detail) {
  total += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    const extra = detail === undefined ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    console.log(`FAIL  ${label}${extra}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function waitForColumns(conn) {
  const wanted = [
    ['users', 'is_active'],
    ['users', 'must_change_password'],
    ['users', 'tokens_valid_after'],
    ['menu_items', 'unavailable_since'],
    ['order_items', 'item_category'],
    ['orders', 'staff_id'],
  ];
  for (let i = 0; i < 60; i += 1) {
    const [cols] = await conn.query(
      'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?',
      [DB_NAME],
    );
    const have = new Set(cols.map((c) => `${c.TABLE_NAME}.${c.COLUMN_NAME}`));
    if (wanted.every(([t, c]) => have.has(`${t}.${c}`))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: DB_NAME,
  });
  const itemIds = [];
  let baseOrderId = null;

  try {
    const ready = await waitForColumns(conn);
    check('server migrations created the expected columns', ready);
    if (!ready) return;

    await conn.query("UPDATE orders SET status = 'Canceled' WHERE status = 'Pending'");
    await conn.query("UPDATE shifts SET status = 'Closed' WHERE status = 'Open'");
    await conn.query("UPDATE tables SET status = 'Empty', merged_into = NULL");
    const [[{ maxId }]] = await conn.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM orders');
    baseOrderId = maxId;

    await conn.execute('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
    const hash = await bcrypt.hash(ADMIN_PASS, 10);
    await conn.execute(
      `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
       VALUES (?, ?, ?, 'Admin', '[]', 1, 0)`,
      ['Order Audit Admin', ADMIN_USER, hash],
    );
    const login = await call('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
    const token = login.body?.token;
    check('admin login returns a token', login.status === 200 && !!token, login);
    if (!token) return;

    const line = (extra = {}) => ({ menu_item_id: MENU_ID, name: MENU_NAME, quantity: 1, ...extra });
    const place = (target, items) => call('POST', '/orders', { token, body: { target_id: target, items } });
    const put = (target, items) => call('PUT', '/orders/items', { token, body: { target_id: target, items } });
    const pay = (target) => call('POST', '/orders/checkout', { token, body: { target_id: target, payment_method: 'Cash' } });
    const tableStatus = async (id) => (await conn.query('SELECT status FROM tables WHERE id = ?', [id]))[0][0]?.status;

    const parallel = [1, 2, 3, 4, 5, 6];
    for (const id of parallel) {
      const placed = await place(String(id), [line({ quantity: id })]);
      if (placed.status !== 201) check(`seed table ${id} order`, false, placed);
    }
    const tk = await place('takeout', [line()]);
    check('seed takeout order', tk.status === 201, tk);
    const paid = await Promise.all([...parallel.map((id) => pay(String(id))), pay('takeout')]);
    check('7 parallel checkouts all return 200', paid.every((r) => r.status === 200), paid.map((r) => [r.status, r.body?.message]));
    const invoices = paid.map((r) => r.body?.invoice_id);
    check('parallel checkouts get 7 distinct invoice ids', new Set(invoices).size === 7 && invoices.every(Boolean), invoices);

    for (const id of [1, 2, 3, 4]) await place(String(id), [line({ quantity: 2 })]);
    const splitPaid = await Promise.all([
      ...[1, 2].map((id) => pay(String(id))),
      ...[3, 4].map((id) =>
        call('POST', '/orders/split-checkout', {
          token,
          body: { target_id: String(id), payment_method: 'Cash', items: [{ menu_item_id: MENU_ID, name: MENU_NAME, qty: 1 }] },
        }),
      ),
    ]);
    check('checkout and split-checkout in parallel all return 200', splitPaid.every((r) => r.status === 200), splitPaid.map((r) => [r.status, r.body?.message]));
    check('mixed parallel payments get distinct invoice ids', new Set(splitPaid.map((r) => r.body?.invoice_id)).size === 4, splitPaid.map((r) => r.body?.invoice_id));
    await pay('3');
    await pay('4');

    const [[freeLock]] = await conn.query(`SELECT IS_FREE_LOCK(CONCAT(?, ':invoice-allocation')) AS free`, [DB_NAME]);
    check('the invoice lock is free again after the payments', Number(freeLock.free) === 1, freeLock);

    for (const bad of [1.5, 0, 1e-9, 1e10, 99999, 1000, -1, 'abc', null, '1.5', '2e1']) {
      const r = await place('7', [line({ quantity: bad })]);
      check(`POST /orders quantity ${JSON.stringify(bad)} is rejected with 400`, r.status === 400 && /whole quantity/.test(r.body?.message || ''), r);
      const p = await put('7', [line({ quantity: bad })]);
      check(`PUT /orders/items quantity ${JSON.stringify(bad)} is rejected with 400`, p.status === 400, p);
    }
    const noQty = await place('7', [{ menu_item_id: MENU_ID, name: MENU_NAME }]);
    check('a line without any quantity is rejected', noQty.status === 400, noQty);
    const [[pending7]] = await conn.query("SELECT COUNT(*) AS n FROM orders WHERE target_id = 7 AND status = 'Pending'");
    check('rejected quantities leave no order behind', Number(pending7.n) === 0, pending7);

    const aliasQty = await place('7', [{ menu_item_id: MENU_ID, name: MENU_NAME, qty: 3 }]);
    check('a line using the qty alias is accepted', aliasQty.status === 201 && aliasQty.body?.lines?.[0]?.quantity === 3, aliasQty);
    const maxQty = await put('7', [line({ quantity: 999 })]);
    check('quantity 999 is accepted on PUT', maxQty.status === 200 && maxQty.body?.lines?.[0]?.quantity === 999, maxQty);
    const stringQty = await put('7', [line({ quantity: '4' })]);
    check('a whole-number string quantity is accepted and stored as a number', stringQty.status === 200 && stringQty.body?.lines?.[0]?.quantity === 4, stringQty);
    const splitBad = await call('POST', '/orders/split-checkout', {
      token,
      body: { target_id: '7', payment_method: 'Cash', items: [{ menu_item_id: MENU_ID, name: MENU_NAME, qty: 1000 }] },
    });
    check('split-checkout quantity above 999 is rejected with 400', splitBad.status === 400, splitBad);
    await put('7', []);

    const badTargets = ['abc3', '3abc', '3.5', '-3', '0', ' ', '1e2'];
    for (const target of badTargets) {
      const r = await place(target, [line()]);
      check(`POST /orders target ${JSON.stringify(target)} is rejected with 400`, r.status === 400, r);
    }
    const missingTable = await place('4242', [line()]);
    check('POST /orders on a table that does not exist returns 404', missingTable.status === 404, missingTable);
    const missingPut = await put('4242', [line()]);
    check('PUT /orders/items on a table that does not exist returns 404', missingPut.status === 404, missingPut);
    const [[ghost]] = await conn.query('SELECT COUNT(*) AS n FROM orders WHERE target_id = 4242');
    check('no order is created for a table that does not exist', Number(ghost.n) === 0, ghost);
    const missingPay = await pay('4242');
    check('checkout on a table that does not exist is not a 200', missingPay.status !== 200 && missingPay.status < 500, missingPay);

    await conn.query("UPDATE tables SET status = 'Empty' WHERE id IN (7, 8)");
    const emptyMove = await call('POST', '/tables/transfer', { token, body: { from_table_id: 7, to_table_id: 8 } });
    check('transferring a table with no active order returns 400', emptyMove.status === 400 && /no active order/i.test(emptyMove.body?.message || ''), emptyMove);
    check('a refused transfer leaves the destination Empty', (await tableStatus(8)) === 'Empty', await tableStatus(8));
    await place('7', [line()]);
    await conn.query("UPDATE tables SET status = 'Occupied' WHERE id = 7");
    const goodMove = await call('POST', '/tables/transfer', { token, body: { from_table_id: 7, to_table_id: 8 } });
    check('transferring a table that has an order still works', goodMove.status === 200, goodMove);
    check('the destination is Occupied and the source Empty after a real transfer', (await tableStatus(8)) === 'Occupied' && (await tableStatus(7)) === 'Empty');
    await put('8', []);

    const badShifts = [
      [{ opening_float_usd: -5 }, 'negative usd float'],
      [{ opening_float_khr: -100 }, 'negative khr float'],
      [{ opening_float_usd: 1000000.01 }, 'usd float above the cap'],
      [{ opening_float_usd: 1e12 }, 'huge usd float'],
      [{ opening_float_khr: 4000000001 }, 'khr float above the cap'],
      [{ opening_float_usd: 'abc' }, 'non-numeric float'],
    ];
    for (const [body, label] of badShifts) {
      const r = await call('POST', '/shifts/start', { token, body });
      check(`shift start with ${label} returns 400`, r.status === 400, r);
    }
    const okShift = await call('POST', '/shifts/start', { token, body: { opening_float_usd: 1000000, opening_float_khr: 4000000000 } });
    check('shift start at exactly the caps works', okShift.status === 201, okShift);
    const shiftId = okShift.body?.shift?.id;
    const badEnd = await call('POST', '/shifts/end', { token, body: { shift_id: shiftId, closing_cash_usd: 1e9, closing_cash_khr: 0 } });
    check('shift end with a huge usd count returns 400', badEnd.status === 400, badEnd);
    const badEndKhr = await call('POST', '/shifts/end', { token, body: { shift_id: shiftId, closing_cash_usd: 5, closing_cash_khr: 5e10 } });
    check('shift end with a huge khr count returns 400', badEndKhr.status === 400, badEndKhr);
    const goodEnd = await call('POST', '/shifts/end', { token, body: { shift_id: shiftId, closing_cash_usd: 5, closing_cash_khr: 0 } });
    check('shift end with sane counts closes the shift', goodEnd.status === 200, goodEnd);

    await place('1', [line()]);
    const bigCash = await call('POST', '/orders/checkout', { token, body: { target_id: '1', payment_method: 'Cash', received_usd: 2000000 } });
    check('checkout with received_usd above the cap returns 400', bigCash.status === 400, bigCash);
    const bigKhr = await call('POST', '/orders/checkout', { token, body: { target_id: '1', payment_method: 'Cash', received_khr: 5000000000 } });
    check('checkout with received_khr above the cap returns 400', bigKhr.status === 400, bigKhr);
    const okCash = await call('POST', '/orders/checkout', { token, body: { target_id: '1', payment_method: 'Cash', received_usd: 1000000 } });
    check('checkout with received_usd at the cap succeeds', okCash.status === 200, okCash);

    const offName = `E2E Off Sale ${RUN}`;
    const created = await call('POST', '/menu', { token, body: { name: offName, category: 'Cold Drinks', price: 2 } });
    const offId = created.body?.item?.id;
    if (offId) itemIds.push(offId);
    check('created a menu item for the off-sale checks', !!offId, created);
    const offLine = { menu_item_id: offId, name: offName, quantity: 1 };
    const onSale = await place('5', [offLine]);
    check('an on-sale item can be ordered', onSale.status === 201, onSale);
    const off = await call('PATCH', `/menu/${offId}/availability`, { token, body: { is_available: false } });
    check('item is switched off sale', off.status === 200, off);
    const offPost = await place('5', [line(), { ...offLine, quantity: 1 }]);
    check('POST /orders with an off-sale item returns 409 naming the item', offPost.status === 409 && (offPost.body?.message || '').includes(offName), offPost);
    const [[after409]] = await conn.query("SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.target_id = 5 AND o.status = 'Pending' AND oi.menu_item_id = ?", [MENU_ID]);
    check('the 409 rolls back the other lines of the same request', Number(after409.n) === 0, after409);
    const offPut = await put('5', [{ ...offLine, quantity: 2 }]);
    check('PUT that raises an off-sale line returns 409', offPut.status === 409 && (offPut.body?.message || '').includes(offName), offPut);
    const keepPut = await put('5', [offLine]);
    check('PUT that keeps an already-billed off-sale line unchanged is allowed', keepPut.status === 200, keepPut);
    const lowerPut = await put('5', [offLine, line()]);
    check('PUT that adds a normal item beside an already-billed off-sale line is allowed', lowerPut.status === 200, lowerPut);
    await put('5', []);
    const offFresh = await place('6', [offLine]);
    check('a fresh order for an off-sale item is refused', offFresh.status === 409, offFresh);

    const [[openPending]] = await conn.query("SELECT COUNT(*) AS n FROM orders WHERE id > ? AND status = 'Pending'", [baseOrderId]);
    check('no pending orders are left over', Number(openPending.n) === 0, openPending);
  } finally {
    try {
      const id = baseOrderId ?? Number.MAX_SAFE_INTEGER;
      await conn.query('DELETE FROM stock_movements WHERE order_id > ?', [id]);
      await conn.query('DELETE FROM order_items WHERE order_id > ?', [id]);
      await conn.query('DELETE FROM orders WHERE id > ?', [id]);
      if (itemIds.length) await conn.query('DELETE FROM menu_items WHERE id IN (?)', [itemIds]);
      await conn.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [ADMIN_USER]);
      await conn.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
    } catch (error) {
      console.log(`WARN  cleanup failed: ${error.message}`);
    }
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
