const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5611;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'menutest_admin';
const ADMIN_PASS = 'Menu-Test-Only-9!';
const CASHIER_USER = 'menutest_cashier';
const CASHIER_PASS = 'Cashier-Test-1x';
const RUN = Date.now().toString(36);
const DAY_MS = 24 * 60 * 60 * 1000;

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

const login = (username, password) => call('POST', '/auth/login', { body: { username, password } });

async function waitForColumns(conn) {
  const wanted = [
    ['users', 'is_active'],
    ['users', 'must_change_password'],
    ['users', 'tokens_valid_after'],
    ['menu_items', 'unavailable_since'],
    ['order_items', 'item_category'],
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

async function seedUsers(conn) {
  await conn.execute('DELETE FROM users WHERE username IN (?, ?)', [ADMIN_USER, CASHIER_USER]);
  const adminHash = await bcrypt.hash(ADMIN_PASS, 10);
  await conn.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
     VALUES (?, ?, ?, 'Admin', '[]', 1, 0)`,
    ['Menu Test Admin', ADMIN_USER, adminHash],
  );
  const cashierHash = await bcrypt.hash(CASHIER_PASS, 10);
  await conn.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
     VALUES (?, ?, ?, 'Cashier', '[]', 1, 0)`,
    ['Menu Test Cashier', CASHIER_USER, cashierHash],
  );
}

async function cleanup(conn, itemIds, orderIds) {
  const steps = [];
  if (orderIds.length) {
    steps.push(['DELETE FROM order_items WHERE order_id IN (?)', [orderIds]]);
    steps.push(['DELETE FROM orders WHERE id IN (?)', [orderIds]]);
  }
  if (itemIds.length) {
    steps.push(['DELETE FROM menu_item_stock_links WHERE menu_item_id IN (?)', [itemIds]]);
    steps.push(['DELETE FROM menu_items WHERE id IN (?)', [itemIds]]);
  }
  steps.push(['DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))', [ADMIN_USER, CASHIER_USER]]);
  steps.push(['DELETE FROM users WHERE username IN (?, ?)', [ADMIN_USER, CASHIER_USER]]);
  for (const [sql, params] of steps) {
    try {
      await conn.query(sql, params);
    } catch (error) {
      console.log(`WARN  cleanup step failed: ${error.message}`);
    }
  }
}

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: DB_NAME,
  });
  await conn.query('ALTER TABLE menu_items ALTER stock_unlimited SET DEFAULT 1');
  await conn.query('UPDATE menu_items SET stock_unlimited = 1');
  const itemIds = [];
  const orderIds = [];

  try {
    const ready = await waitForColumns(conn);
    check('server migrations created menu_items.unavailable_since and order_items.item_category', ready);
    if (!ready) return;
    await seedUsers(conn);

    const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
    check('admin login returns 200 and a token', adminLogin.status === 200 && !!adminLogin.body?.token, adminLogin);
    const token = adminLogin.body?.token;
    const cashierLogin = await login(CASHIER_USER, CASHIER_PASS);
    check('cashier login returns 200 and a token', cashierLogin.status === 200 && !!cashierLogin.body?.token, cashierLogin);
    const cashierToken = cashierLogin.body?.token;
    if (!token || !cashierToken) return;

    const createItem = async (name, category, price, extra = {}) => {
      const r = await call('POST', '/menu', { token, body: { name, category, price, ...extra } });
      const id = r.body?.item?.id;
      if (id) itemIds.push(id);
      return { ...r, id };
    };
    const listItem = async (id) => {
      const r = await call('GET', '/menu', { token });
      return Array.isArray(r.body) ? r.body.find((i) => i.id === id) : undefined;
    };
    const categoryRevenue = async (name) => {
      const r = await call('GET', '/reports?days=30', { token });
      const row = (r.body?.byCategory || []).find((c) => c.category === name);
      return Number(row?.revenue || 0);
    };
    const sell = async (menuItemId, name) => {
      const placed = await call('POST', '/orders', {
        token,
        body: { target_id: 'takeout', items: [{ menu_item_id: menuItemId, name, quantity: 1 }] },
      });
      if (placed.body?.orderId) orderIds.push(placed.body.orderId);
      const paid = await call('POST', '/orders/checkout', {
        token,
        body: { target_id: 'takeout', payment_method: 'Cash' },
      });
      return { placed, paid };
    };
    const near = (a, b) => Math.abs(a - b) < 0.005;

    const nameOn = `E2E On Sale ${RUN}`;
    const created = await createItem(nameOn, 'Coffee', 77777.77);
    check('create item without is_available returns 201', created.status === 201 && !!created.id, created);
    const onRow = await listItem(created.id);
    check(
      'new item defaults to on sale with unavailable_since null',
      onRow?.is_available === true && onRow?.unavailable_since === null,
      onRow,
    );
    check(
      'new item without sales: has_sales false, can_delete true, no block reason',
      onRow?.has_sales === false && onRow?.can_delete === true && onRow?.delete_block_reason === null && onRow?.delete_available_at === null,
      onRow,
    );

    const offCreated = await createItem(`E2E Off Sale ${RUN}`, 'Coffee', 4.5, { is_available: false });
    check('create item with is_available false returns 201', offCreated.status === 201 && !!offCreated.id, offCreated);
    const offRow = await listItem(offCreated.id);
    check(
      'item created off sale lists is_available false and unavailable_since set',
      offRow?.is_available === false && typeof offRow?.unavailable_since === 'string' && !Number.isNaN(Date.parse(offRow.unavailable_since)),
      offRow,
    );

    const toOn = await call('PATCH', `/menu/${offCreated.id}/availability`, { token, body: { is_available: true } });
    check('PATCH availability true returns 200 with message and item', toOn.status === 200 && !!toOn.body?.message && toOn.body?.item?.is_available === true, toOn);
    const onAgain = await listItem(offCreated.id);
    check('turning on clears unavailable_since', onAgain?.is_available === true && onAgain?.unavailable_since === null, onAgain);
    const toOff = await call('PATCH', `/menu/${offCreated.id}/availability`, { token, body: { is_available: false } });
    check('PATCH availability false returns 200', toOff.status === 200 && toOff.body?.item?.is_available === false, toOff);
    const offAgain = await listItem(offCreated.id);
    check('turning off sets unavailable_since to about now', offAgain?.is_available === false && Math.abs(Date.parse(offAgain?.unavailable_since) - Date.now()) < 5 * 60 * 1000, offAgain);

    const badStr = await call('PATCH', `/menu/${offCreated.id}/availability`, { token, body: { is_available: 'yes' } });
    check('PATCH availability with a string is 400', badStr.status === 400, badStr);
    const badNum = await call('PATCH', `/menu/${offCreated.id}/availability`, { token, body: { is_available: 1 } });
    check('PATCH availability with a number is 400', badNum.status === 400, badNum);
    const badMissing = await call('PATCH', `/menu/${offCreated.id}/availability`, { token, body: {} });
    check('PATCH availability with no field is 400', badMissing.status === 400, badMissing);
    const unknown = await call('PATCH', '/menu/99999999/availability', { token, body: { is_available: true } });
    check('PATCH availability on an unknown id is 404', unknown.status === 404, unknown);

    const putOff = await call('PUT', `/menu/${offCreated.id}`, {
      token,
      body: { name: `E2E Off Sale ${RUN}`, category: 'Coffee', price: 4.5, is_available: true },
    });
    check('PUT with is_available true returns 200', putOff.status === 200, putOff);
    const afterPut = await listItem(offCreated.id);
    check('PUT is_available true turns the item on and clears unavailable_since', afterPut?.is_available === true && afterPut?.unavailable_since === null, afterPut);

    const dupSame = await createItem(nameOn.toUpperCase(), 'Coffee', 5);
    check('duplicate name (different case) in the same category is 400 duplicate_name', dupSame.status === 400 && dupSame.body?.code === 'duplicate_name', dupSame);
    const dupPadded = await createItem(`  ${nameOn}  `, 'Coffee', 5);
    check('duplicate name with surrounding spaces is 400 duplicate_name', dupPadded.status === 400 && dupPadded.body?.code === 'duplicate_name', dupPadded);
    const dupOther = await createItem(nameOn, 'Mains', 5);
    check('same name in a different category is allowed (201)', dupOther.status === 201, dupOther);
    const dupPut = await call('PUT', `/menu/${offCreated.id}`, { token, body: { name: nameOn, category: 'Coffee', price: 4.5 } });
    check('renaming onto an existing name in the category is 400 duplicate_name', dupPut.status === 400 && dupPut.body?.code === 'duplicate_name', dupPut);
    const longName = await createItem('x'.repeat(101), 'Coffee', 5);
    check('101 character name is 400', longName.status === 400, longName);
    const okLong = await createItem(`${RUN}-${'y'.repeat(100 - RUN.length - 1)}`, 'Coffee', 5);
    check('100 character name is accepted (201)', okLong.status === 201, okLong);
    const blankName = await createItem('    ', 'Coffee', 5);
    check('blank name is 400', blankName.status === 400, blankName);
    const objName = await createItem({ a: 1 }, 'Coffee', 5);
    check('object name is 400', objName.status === 400, objName);

    const unused = await createItem(`E2E Unused ${RUN}`, 'Mains', 2.25);
    const [invRows] = await conn.query('SELECT id FROM inventory LIMIT 1');
    let linkedCount = 0;
    if (unused.id && invRows.length) {
      await conn.execute(
        'INSERT INTO menu_item_stock_links (menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit) VALUES (?, ?, ?, ?, ?, ?)',
        [unused.id, '', '', '', invRows[0].id, 1],
      );
      linkedCount = 1;
    }
    const delUnused = await call('DELETE', `/menu/${unused.id}`, { token });
    check('item without sales deletes immediately (200)', delUnused.status === 200, delUnused);
    check(
      'unused delete reports removed_stock_links',
      linkedCount === 0 || Number(delUnused.body?.removed_stock_links) === linkedCount,
      delUnused,
    );
    const [leftLinks] = await conn.execute('SELECT COUNT(*) AS n FROM menu_item_stock_links WHERE menu_item_id = ?', [unused.id]);
    check('unused delete removes its menu_item_stock_links rows', Number(leftLinks[0].n) === 0, leftLinks);
    const [gone] = await conn.execute('SELECT COUNT(*) AS n FROM menu_items WHERE id = ?', [unused.id]);
    check('unused item row is gone from menu_items', Number(gone[0].n) === 0, gone);
    const [auditRows] = await conn.execute(
      "SELECT description FROM audit_logs WHERE action = 'menu_delete' AND description LIKE ? ORDER BY id DESC LIMIT 1",
      [`%E2E Unused ${RUN}%`],
    );
    check('audit log for the delete includes the item name', auditRows.length === 1, auditRows);
    const delAgain = await call('DELETE', `/menu/${unused.id}`, { token });
    check('deleting an already deleted item is 404', delAgain.status === 404, delAgain);

    const baseCoffee = await categoryRevenue('Coffee');
    const baseTea = await categoryRevenue('Tea');
    const baseMains = await categoryRevenue('Mains');
    const baseUncat = await categoryRevenue('Uncategorized');

    const sale = await sell(created.id, nameOn);
    check('order placed through POST /orders returns 201', sale.placed.status === 201, sale.placed);
    check('order paid through POST /orders/checkout returns 200', sale.paid.status === 200, sale.paid);
    const [snapRows] = await conn.execute(
      'SELECT id, menu_item_id, item_name, price, item_category FROM order_items WHERE menu_item_id = ?',
      [created.id],
    );
    check('sale stores the item_category snapshot (Coffee)', snapRows.length === 1 && snapRows[0].item_category === 'Coffee', snapRows);
    const soldLineId = snapRows[0]?.id;

    const soldRow = await listItem(created.id);
    check(
      'item with sales on sale: has_sales true, can_delete false, reason on_sale',
      soldRow?.has_sales === true && soldRow?.can_delete === false && soldRow?.delete_block_reason === 'on_sale',
      soldRow,
    );
    const delOnSale = await call('DELETE', `/menu/${created.id}`, { token });
    check('delete of sold item that is on sale is 409 MENU_ITEM_ON_SALE', delOnSale.status === 409 && delOnSale.body?.code === 'MENU_ITEM_ON_SALE', delOnSale);

    const turnOff = await call('PATCH', `/menu/${created.id}/availability`, { token, body: { is_available: false } });
    check('turning the sold item off sale returns 200', turnOff.status === 200, turnOff);
    const delCooling = await call('DELETE', `/menu/${created.id}`, { token });
    check('delete of sold item off sale for less than 7 days is 409 MENU_ITEM_COOLING_DOWN', delCooling.status === 409 && delCooling.body?.code === 'MENU_ITEM_COOLING_DOWN', delCooling);
    const availableAt = Date.parse(delCooling.body?.delete_available_at);
    check(
      'cooling down response gives delete_available_at about 7 days ahead',
      Number.isFinite(availableAt) && Math.abs(availableAt - (Date.now() + 7 * DAY_MS)) < 10 * 60 * 1000,
      delCooling.body,
    );
    const coolingRow = await listItem(created.id);
    check(
      'GET /menu shows cooling_down with delete_available_at',
      coolingRow?.can_delete === false && coolingRow?.delete_block_reason === 'cooling_down' && !!coolingRow?.delete_available_at,
      coolingRow,
    );
    const [stillThere] = await conn.execute('SELECT COUNT(*) AS n FROM menu_items WHERE id = ?', [created.id]);
    check('blocked delete leaves the item in place', Number(stillThere[0].n) === 1, stillThere);

    const turnOnBlocked = await call('PATCH', `/menu/${created.id}/availability`, { token, body: { is_available: true } });
    check('turning the sold item back on returns 200', turnOnBlocked.status === 200, turnOnBlocked);
    const reOnRow = await listItem(created.id);
    check('after turning on again the block reason is on_sale', reOnRow?.delete_block_reason === 'on_sale' && reOnRow?.unavailable_since === null, reOnRow);
    await call('PATCH', `/menu/${created.id}/availability`, { token, body: { is_available: false } });

    const afterSaleCoffee = await categoryRevenue('Coffee');
    check('category report attributes the sale to Coffee', near(afterSaleCoffee - baseCoffee, 77777.77), { baseCoffee, afterSaleCoffee });

    const moved = await call('PUT', `/menu/${created.id}`, { token, body: { name: nameOn, category: 'Tea', price: 77777.77 } });
    check('moving the sold item to category Tea returns 200', moved.status === 200, moved);
    const movedRow = await listItem(created.id);
    check('PUT without is_available keeps the item off sale and unavailable_since', movedRow?.is_available === false && !!movedRow?.unavailable_since, movedRow);
    const coffeeAfterMove = await categoryRevenue('Coffee');
    const teaAfterMove = await categoryRevenue('Tea');
    check('after changing the category, Coffee revenue for the past sale is unchanged', near(coffeeAfterMove - baseCoffee, 77777.77), { baseCoffee, coffeeAfterMove });
    check('after changing the category, Tea gains nothing from the past sale', near(teaAfterMove - baseTea, 0), { baseTea, teaAfterMove });
    const topAfterMove = await call('GET', '/reports?days=30', { token });
    const topRow = (topAfterMove.body?.topItems || []).find((t) => t.name === nameOn);
    check('top items keeps the original category (Coffee) for the sold item', topRow?.category === 'Coffee', topRow);

    await conn.execute('UPDATE menu_items SET unavailable_since = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?', [created.id]);
    const eligibleRow = await listItem(created.id);
    check('after 8 days off sale GET /menu reports can_delete true', eligibleRow?.can_delete === true && eligibleRow?.delete_block_reason === null, eligibleRow);

    const cDelBlocked = await call('DELETE', `/menu/${created.id}`, { token: cashierToken });
    check('Cashier without menu permission gets 403 on DELETE', cDelBlocked.status === 403, cDelBlocked);
    const cPatch = await call('PATCH', `/menu/${created.id}/availability`, { token: cashierToken, body: { is_available: true } });
    check('Cashier without menu permission gets 403 on PATCH availability', cPatch.status === 403, cPatch);
    const noPatch = await call('PATCH', `/menu/${created.id}/availability`, { body: { is_available: true } });
    check('no token gets 401 on PATCH availability', noPatch.status === 401, noPatch);
    const noDel = await call('DELETE', `/menu/${created.id}`);
    check('no token gets 401 on DELETE', noDel.status === 401, noDel);

    const delOld = await call('DELETE', `/menu/${created.id}`, { token });
    check('delete of sold item off sale for 8 days is 200', delOld.status === 200, delOld);
    const [kept] = await conn.execute(
      'SELECT id, menu_item_id, item_name, price, item_category FROM order_items WHERE id = ?',
      [soldLineId],
    );
    check('past order_items row still exists after the delete', kept.length === 1, kept);
    check('past order_items row has menu_item_id NULL', kept[0]?.menu_item_id === null, kept);
    check(
      'past order_items row keeps item_name, price and item_category',
      kept[0]?.item_name === nameOn && Number(kept[0]?.price) === 77777.77 && kept[0]?.item_category === 'Coffee',
      kept,
    );
    const coffeeAfterDelete = await categoryRevenue('Coffee');
    const uncatAfterDelete = await categoryRevenue('Uncategorized');
    check('after deleting the item, Coffee still holds the sale revenue', near(coffeeAfterDelete - baseCoffee, 77777.77), { baseCoffee, coffeeAfterDelete });
    check('after deleting the item, nothing moves into Uncategorized', near(uncatAfterDelete - baseUncat, 0), { baseUncat, uncatAfterDelete });
    const [auditDel] = await conn.execute(
      "SELECT description FROM audit_logs WHERE action = 'menu_delete' AND description LIKE ? ORDER BY id DESC LIMIT 1",
      [`%${nameOn}%`],
    );
    check('audit log for the delete of a sold item includes the item name', auditDel.length === 1, auditDel);

    const second = await createItem(`E2E Mains ${RUN}`, 'Mains', 3.33);
    const sale2 = await sell(second.id, `E2E Mains ${RUN}`);
    check('second sale (Mains) is placed and paid', sale2.placed.status === 201 && sale2.paid.status === 200, { placed: sale2.placed, paid: sale2.paid });
    await call('PATCH', `/menu/${second.id}/availability`, { token, body: { is_available: false } });
    await conn.execute('UPDATE menu_items SET unavailable_since = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?', [second.id]);
    const delSecond = await call('DELETE', `/menu/${second.id}`, { token });
    check('second sold item deletes after 8 days off sale', delSecond.status === 200, delSecond);
    const mainsAfter = await categoryRevenue('Mains');
    const uncatFinal = await categoryRevenue('Uncategorized');
    check('new sale of a since-deleted item is attributed to Mains', near(mainsAfter - baseMains, 3.33), { baseMains, mainsAfter });
    check('new sale of a since-deleted item is never Uncategorized', near(uncatFinal - baseUncat, 0), { baseUncat, uncatFinal });
    const teaFinal = await categoryRevenue('Tea');
    check('Tea revenue is still untouched at the end', near(teaFinal - baseTea, 0), { baseTea, teaFinal });
  } finally {
    await cleanup(conn, itemIds, orderIds);
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
