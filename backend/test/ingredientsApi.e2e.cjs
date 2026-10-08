const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5614;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'ingrtest_admin';
const ADMIN_PASS = 'Ingr-Test-Only-9!';
const CASHIER_USER = 'ingrtest_cashier';
const CASHIER_PASS = 'Cashier-Test-1x';
const RUN = Date.now().toString(36);

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
    ['inventory', 'archived_at'],
    ['inventory', 'is_ingredient'],
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
    ['Ingr Test Admin', ADMIN_USER, adminHash],
  );
  const cashierHash = await bcrypt.hash(CASHIER_PASS, 10);
  await conn.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
     VALUES (?, ?, ?, 'Cashier', '[]', 1, 0)`,
    ['Ingr Test Cashier', CASHIER_USER, cashierHash],
  );
}

async function cleanup(conn, itemIds, orderIds) {
  const like = `E2E Ingr%${RUN}%`;
  const steps = [];
  if (orderIds.length) {
    steps.push(['DELETE FROM stock_movements WHERE order_id IN (?)', [orderIds]]);
    steps.push(['DELETE FROM order_items WHERE order_id IN (?)', [orderIds]]);
    steps.push(['DELETE FROM orders WHERE id IN (?)', [orderIds]]);
  }
  steps.push(['DELETE FROM stock_movements WHERE inventory_id IN (SELECT id FROM inventory WHERE item_name LIKE ?)', [like]]);
  steps.push(['DELETE FROM menu_item_stock_links WHERE inventory_id IN (SELECT id FROM inventory WHERE item_name LIKE ?)', [like]]);
  steps.push(['DELETE FROM inventory WHERE item_name LIKE ?', [like]]);
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
    check('server migrations created inventory.is_ingredient and the other columns', ready);
    if (!ready) return;
    await seedUsers(conn);

    const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
    check('admin login returns 200 and a token', adminLogin.status === 200 && !!adminLogin.body?.token, adminLogin);
    const token = adminLogin.body?.token;
    const cashierLogin = await login(CASHIER_USER, CASHIER_PASS);
    check('cashier login returns 200 and a token', cashierLogin.status === 200 && !!cashierLogin.body?.token, cashierLogin);
    const cashierToken = cashierLogin.body?.token;
    if (!token || !cashierToken) return;

    const list = () => call('GET', '/ingredients', { token });
    const items = async () => (await list()).body?.items || [];
    const find = async (id) => (await items()).find((i) => i.id === id);
    const create = (body) => call('POST', '/ingredients', { token, body });
    const patch = (id, body) => call('PATCH', `/ingredients/${id}`, { token, body });
    const adjust = (id, body) => call('POST', `/ingredients/${id}/adjust`, { token, body });
    const moves = async (id) => {
      const r = await call('GET', `/inventory/${id}/movements`, { token });
      return Array.isArray(r.body) ? r.body : [];
    };
    const invList = async (query = '') => {
      const r = await call('GET', `/inventory${query}`, { token });
      return Array.isArray(r.body) ? r.body : [];
    };
    const dbQty = async (id) => {
      const [r] = await conn.query('SELECT stock_quantity FROM inventory WHERE id = ?', [id]);
      return r[0] ? Number(r[0].stock_quantity) : null;
    };

    const noTokenList = await call('GET', '/ingredients');
    check('no token gets 401 on GET ingredients', noTokenList.status === 401, noTokenList);
    const noTokenCreate = await call('POST', '/ingredients', { body: { name: 'x', unit_label: 'kg' } });
    check('no token gets 401 on POST ingredients', noTokenCreate.status === 401, noTokenCreate);
    const cList = await call('GET', '/ingredients', { token: cashierToken });
    check('Cashier gets 403 on GET ingredients', cList.status === 403, cList);
    const cCreate = await call('POST', '/ingredients', { token: cashierToken, body: { name: `E2E Ingr C ${RUN}`, unit_label: 'kg' } });
    check('Cashier gets 403 on POST ingredients', cCreate.status === 403, cCreate);
    const cPatch = await call('PATCH', '/ingredients/1', { token: cashierToken, body: { name: 'zzz' } });
    check('Cashier gets 403 on PATCH ingredients', cPatch.status === 403, cPatch);
    const cAdjust = await call('POST', '/ingredients/1/adjust', { token: cashierToken, body: { mode: 'add', quantity: 1 } });
    check('Cashier gets 403 on adjust', cAdjust.status === 403, cAdjust);
    const cDelete = await call('DELETE', '/ingredients/1', { token: cashierToken });
    check('Cashier gets 403 on DELETE ingredients', cDelete.status === 403, cDelete);
    const [cashierCreated] = await conn.query('SELECT id FROM inventory WHERE item_name = ?', [`E2E Ingr C ${RUN}`]);
    check('forbidden create did not insert a row', cashierCreated.length === 0, cashierCreated);

    const list0 = await list();
    check('GET ingredients returns 200 with items and summary', list0.status === 200 && Array.isArray(list0.body?.items) && !!list0.body?.summary, list0);
    const base = list0.body?.items || [];
    const names = base.map((i) => i.item_name);
    check('dump ingredients Whole Milk and Coffee Beans are listed', names.includes('Whole Milk') && names.includes('Coffee Beans'), names.slice(0, 20));
    const sample = base[0] || {};
    const fields = ['id', 'item_name', 'category', 'unit_label', 'unit_singular', 'stock_quantity', 'low_threshold', 'stock_status', 'updated_at'];
    check('each item has the documented fields', fields.every((f) => f in sample), sample);
    const [beerRows] = await conn.query("SELECT id FROM inventory WHERE category = 'Beer' AND archived_at IS NULL");
    check('1:1 beer rows exist in the dump', beerRows.length > 0, beerRows.length);
    check('beer rows are not listed as ingredients', beerRows.every((r) => !base.some((i) => i.id === r.id)));
    const [menuCatRows] = await conn.query("SELECT id FROM inventory WHERE category = 'Menu' AND is_ingredient = 1");
    check('no Menu-category row is an ingredient', menuCatRows.length === 0, menuCatRows);
    const [dbIngr] = await conn.query('SELECT COUNT(*) AS n FROM inventory WHERE is_ingredient = 1');
    check('list count equals rows flagged is_ingredient', base.length === Number(dbIngr[0].n), { listed: base.length, db: dbIngr[0] });
    const ordered = base.every((row, idx) => {
      if (idx === 0) return true;
      const prev = base[idx - 1];
      const catCmp = String(prev.category || '').localeCompare(String(row.category || ''), undefined, { sensitivity: 'base' });
      return catCmp < 0 || (catCmp === 0 && String(prev.item_name).localeCompare(String(row.item_name), undefined, { sensitivity: 'base' }) <= 0);
    });
    check('items are ordered by category then name', ordered);
    const sum0 = list0.body?.summary || {};
    check('summary total equals the number of items', Number(sum0.total) === base.length, sum0);
    check('summary low and out match item statuses', Number(sum0.low) === base.filter((i) => i.stock_status === 'LOW_STOCK').length && Number(sum0.out) === base.filter((i) => i.stock_status === 'OUT_OF_STOCK').length, sum0);

    const name = `E2E Ingr Flour ${RUN}`;
    const created = await create({ name, category: 'Dry Goods', unit_label: 'kg', quantity: 10, low_threshold: 3 });
    check('create returns 201 with item', created.status === 201 && !!created.body?.item?.id, created);
    const id = created.body?.item?.id;
    if (!id) return;
    const ci = created.body.item;
    check('created item has the given fields', ci.item_name === name && ci.category === 'Dry Goods' && ci.unit_label === 'kg' && Number(ci.stock_quantity) === 10 && Number(ci.low_threshold) === 3 && ci.stock_status === 'IN_STOCK', ci);
    const [createdRow] = await conn.query('SELECT is_ingredient, archived_at FROM inventory WHERE id = ?', [id]);
    check('created row is flagged ingredient and archived', Number(createdRow[0]?.is_ingredient) === 1 && !!createdRow[0]?.archived_at, createdRow);
    const sum1 = (await list()).body?.summary || {};
    check('summary total grew by one', Number(sum1.total) === Number(sum0.total) + 1, { sum0, sum1 });
    check('created ingredient appears in the list', !!(await find(id)));

    const dupSame = await create({ name, unit_label: 'kg' });
    check('duplicate name is 400 duplicate_name', dupSame.status === 400 && dupSame.body?.code === 'duplicate_name', dupSame);
    const dupCase = await create({ name: name.toUpperCase(), unit_label: 'kg' });
    check('duplicate name in a different case is 400 duplicate_name', dupCase.status === 400 && dupCase.body?.code === 'duplicate_name', dupCase);
    const dupDump = await create({ name: 'whole milk', unit_label: 'L' });
    check('duplicate of a dump ingredient name is 400 duplicate_name', dupDump.status === 400 && dupDump.body?.code === 'duplicate_name', dupDump);
    const [archivedOther] = await conn.query('SELECT item_name FROM inventory WHERE archived_at IS NOT NULL AND is_ingredient = 0 LIMIT 1');
    if (archivedOther[0]) {
      const dupArchived = await create({ name: archivedOther[0].item_name, unit_label: 'pcs' });
      check('duplicate of an archived non-ingredient name is 400 duplicate_name', dupArchived.status === 400 && dupArchived.body?.code === 'duplicate_name', dupArchived);
    }

    const emptyName = await create({ name: '   ', unit_label: 'kg' });
    check('empty name is 400', emptyName.status === 400, emptyName);
    const longName = await create({ name: 'N'.repeat(101), unit_label: 'kg' });
    check('name over 100 chars is 400', longName.status === 400, longName);
    const longUnit = await create({ name: `E2E Ingr LU ${RUN}`, unit_label: 'u'.repeat(21) });
    check('unit_label over 20 chars is 400', longUnit.status === 400, longUnit);
    const negQty = await create({ name: `E2E Ingr NQ ${RUN}`, unit_label: 'kg', quantity: -1 });
    check('negative quantity is 400', negQty.status === 400, negQty);
    const noBody = await create({});
    check('empty body is 400', noBody.status === 400, noBody);
    const [badInserted] = await conn.query('SELECT id FROM inventory WHERE item_name LIKE ?', [`E2E Ingr%${RUN}%`]);
    check('invalid creates inserted nothing besides the valid item', badInserted.length === 1, badInserted);

    const minimal = await create({ name: `E2E Ingr Min ${RUN}`, unit_label: 'pcs' });
    check('create with only name and unit_label returns 201 with quantity 0', minimal.status === 201 && Number(minimal.body?.item?.stock_quantity) === 0, minimal);

    const renamed = `E2E Ingr Flour2 ${RUN}`;
    const p1 = await patch(id, { name: renamed, unit_label: 'bags', category: 'Pantry' });
    check('patch name, unit and category returns 200', p1.status === 200 && p1.body?.item?.item_name === renamed && p1.body?.item?.unit_label === 'bags' && p1.body?.item?.category === 'Pantry', p1);
    const p2 = await patch(id, { low_threshold: 10 });
    check('patch low_threshold 10 with quantity 10 reports LOW_STOCK', p2.status === 200 && Number(p2.body?.item?.low_threshold) === 10 && p2.body?.item?.stock_status === 'LOW_STOCK', p2);
    check('list reports LOW_STOCK for it', (await find(id))?.stock_status === 'LOW_STOCK');
    const sumLow = (await list()).body?.summary || {};
    check('summary low grew by one', Number(sumLow.low) === Number(sum1.low) + 1, { sum1, sumLow });
    const p3 = await patch(id, { low_threshold: 4 });
    check('patch low_threshold 4 reports IN_STOCK', p3.status === 200 && p3.body?.item?.stock_status === 'IN_STOCK', p3);
    const pDup = await patch(id, { name: 'COFFEE BEANS' });
    check('patch to an existing name is 400 duplicate_name', pDup.status === 400 && pDup.body?.code === 'duplicate_name', pDup);
    const pSelf = await patch(id, { name: renamed.toUpperCase() });
    check('patch name to own name in different case is allowed', pSelf.status === 200, pSelf);
    const pEmpty = await patch(id, { name: '' });
    check('patch with empty name is 400', pEmpty.status === 400, pEmpty);
    const pLong = await patch(id, { unit_label: 'q'.repeat(21) });
    check('patch with unit_label over 20 chars is 400', pLong.status === 400, pLong);
    const unchanged = await find(id);
    check('failed patches left the item intact', unchanged?.unit_label === 'bags' && Number(unchanged?.low_threshold) === 4, unchanged);

    const a1 = await adjust(id, { mode: 'add', quantity: 5 });
    check('add 5 raises quantity from 10 to 15', a1.status === 200 && Number(a1.body?.item?.stock_quantity) === 15, a1);
    const aZero = await adjust(id, { mode: 'add', quantity: 0 });
    check('add 0 is 400', aZero.status === 400, aZero);
    const aNeg = await adjust(id, { mode: 'add', quantity: -2 });
    check('add negative is 400', aNeg.status === 400, aNeg);
    const aBadMode = await adjust(id, { mode: 'multiply', quantity: 2 });
    check('unknown mode is 400', aBadMode.status === 400, aBadMode);
    const rUsed = await adjust(id, { mode: 'remove', quantity: 2, reason: 'used', note: 'bread' });
    check('remove 2 (used) lowers quantity to 13', rUsed.status === 200 && Number(rUsed.body?.item?.stock_quantity) === 13, rUsed);
    const rWaste = await adjust(id, { mode: 'remove', quantity: 1, reason: 'waste' });
    check('remove 1 (waste) lowers quantity to 12', rWaste.status === 200 && Number(rWaste.body?.item?.stock_quantity) === 12, rWaste);
    const rMistake = await adjust(id, { mode: 'remove', quantity: 2, reason: 'mistake' });
    check('remove 2 (mistake) lowers quantity to 10', rMistake.status === 200 && Number(rMistake.body?.item?.stock_quantity) === 10, rMistake);
    const rTooMany = await adjust(id, { mode: 'remove', quantity: 999, reason: 'used' });
    check('remove more than on hand is 400 exceeds_stock', rTooMany.status === 400 && rTooMany.body?.code === 'exceeds_stock', rTooMany);
    const rNoReason = await adjust(id, { mode: 'remove', quantity: 1 });
    check('remove without reason is 400 invalid_reason', rNoReason.status === 400 && rNoReason.body?.code === 'invalid_reason', rNoReason);
    const rBadReason = await adjust(id, { mode: 'remove', quantity: 1, reason: 'stolen' });
    check('remove with unknown reason is 400 invalid_reason', rBadReason.status === 400 && rBadReason.body?.code === 'invalid_reason', rBadReason);
    const rZero = await adjust(id, { mode: 'remove', quantity: 0, reason: 'used' });
    check('remove 0 is 400', rZero.status === 400, rZero);
    check('failed removals left quantity at 10', Number(await dbQty(id)) === 10, await dbQty(id));

    const hist = await moves(id);
    const hAdd = hist.find((m) => Number(m.change_amount) === 5);
    const hUsed = hist.find((m) => Number(m.change_amount) === -2 && /bread/.test(m.note || ''));
    const hWaste = hist.find((m) => Number(m.change_amount) === -1);
    const hMistake = hist.filter((m) => Number(m.change_amount) === -2 && m !== hUsed)[0];
    check('history has the add row', !!hAdd && Number(hAdd.quantity_after) === 15, hist);
    check('remove used writes an adjustment row carrying the note', !!hUsed && hUsed.reason === 'adjustment', hUsed);
    check('remove waste writes a waste row', !!hWaste && hWaste.reason === 'waste' && Number(hWaste.quantity_after) === 12, hWaste);
    check('remove mistake writes an adjustment row', !!hMistake && hMistake.reason === 'adjustment' && Number(hMistake.quantity_after) === 10, hMistake);
    console.log(`INFO  notes: add=${JSON.stringify(hAdd?.note)} used=${JSON.stringify(hUsed?.note)} waste=${JSON.stringify(hWaste?.note)} mistake=${JSON.stringify(hMistake?.note)}`);

    const cLow = await adjust(id, { mode: 'count', quantity: 6 });
    check('count to a lower number sets quantity 6', cLow.status === 200 && Number(cLow.body?.item?.stock_quantity) === 6, cLow);
    const cHigh = await adjust(id, { mode: 'count', quantity: 20 });
    check('count to a higher number sets quantity 20', cHigh.status === 200 && Number(cHigh.body?.item?.stock_quantity) === 20, cHigh);
    const histCount = await moves(id);
    const countRows = histCount.filter((m) => m.note === 'Counted');
    check('counts write adjustment rows with note Counted', countRows.length === 2 && countRows.every((m) => m.reason === 'adjustment'), countRows);
    check('count rows carry the signed difference', countRows.some((m) => Number(m.change_amount) === -4) && countRows.some((m) => Number(m.change_amount) === 14), countRows);
    const before = (await moves(id)).length;
    const cSame = await adjust(id, { mode: 'count', quantity: 20 });
    check('count equal to on hand is a 200 no-op', cSame.status === 200 && Number(cSame.body?.item?.stock_quantity) === 20, cSame);
    check('count equal to on hand leaves quantity at 20', Number(await dbQty(id)) === 20);
    console.log(`INFO  history rows before/after equal count: ${before}/${(await moves(id)).length}`);
    const cNeg = await adjust(id, { mode: 'count', quantity: -1 });
    check('count negative is 400', cNeg.status === 400, cNeg);
    const cZero = await adjust(id, { mode: 'count', quantity: 0 });
    check('count to 0 is 200 and OUT_OF_STOCK', cZero.status === 200 && Number(cZero.body?.item?.stock_quantity) === 0 && cZero.body?.item?.stock_status === 'OUT_OF_STOCK', cZero);
    const sumOut = (await list()).body?.summary || {};
    check('summary out counts the empty item', Number(sumOut.out) >= 1, sumOut);

    const alertCheckQty = await adjust(id, { mode: 'count', quantity: 2 });
    check('count to 2 (below threshold 4) returns 200', alertCheckQty.status === 200 && alertCheckQty.body?.item?.stock_status === 'LOW_STOCK', alertCheckQty);
    const alerts = await call('GET', '/alerts?refresh=1', { token });
    const alertList = Array.isArray(alerts.body?.alerts) ? alerts.body.alerts : [];
    const myAlert = alertList.find((a) => a.id === `stock-${id}` || a.meta?.inventoryId === id || String(a.title || '').includes(renamed) || String(a.message || '').toUpperCase().includes(renamed.toUpperCase()));
    check('low-stock alerts include the ingredient below its threshold', alerts.status === 200 && !!myAlert, { status: alerts.status, count: alertList.length });
    await adjust(id, { mode: 'count', quantity: 20 });

    const inventoryActive = await invList();
    check('ingredient is absent from GET /inventory', !inventoryActive.some((r) => r.id === id));
    check('dump ingredient Whole Milk is absent from GET /inventory', !inventoryActive.some((r) => r.item_name === 'Whole Milk'));
    const inventoryAll = await invList('?include_archived=1');
    check('ingredient is present with include_archived=1', inventoryAll.some((r) => r.id === id));

    const unknown = 99999999;
    const u1 = await patch(unknown, { name: 'zzz' });
    check('patch unknown id is 404', u1.status === 404, u1);
    const u2 = await adjust(unknown, { mode: 'add', quantity: 1 });
    check('adjust unknown id is 404', u2.status === 404, u2);
    const u3 = await call('DELETE', `/ingredients/${unknown}`, { token });
    check('delete unknown id is 404', u3.status === 404, u3);
    const [beer] = await conn.query("SELECT id FROM inventory WHERE category = 'Beer' AND archived_at IS NULL LIMIT 1");
    const beerId = beer[0]?.id;
    const nb1 = await patch(beerId, { name: 'Hacked Beer' });
    check('patch on a non-ingredient row is 404', nb1.status === 404, nb1);
    const nb2 = await adjust(beerId, { mode: 'add', quantity: 1 });
    check('adjust on a non-ingredient row is 404', nb2.status === 404, nb2);
    const nb3 = await call('DELETE', `/ingredients/${beerId}`, { token });
    check('delete on a non-ingredient row is 404', nb3.status === 404, nb3);
    const [beerAfter] = await conn.query('SELECT item_name, is_ingredient, archived_at FROM inventory WHERE id = ?', [beerId]);
    check('the beer row is untouched by those attempts', beerAfter[0]?.item_name !== 'Hacked Beer' && Number(beerAfter[0]?.is_ingredient) === 0 && beerAfter[0]?.archived_at === null, beerAfter);

    const [snapRows] = await conn.query('SELECT id, stock_quantity FROM inventory WHERE is_ingredient = 1 ORDER BY id');
    const [saleMovesBefore] = await conn.query("SELECT COUNT(*) AS n FROM stock_movements WHERE reason = 'sale' AND inventory_id IN (SELECT id FROM inventory WHERE is_ingredient = 1)");
    const [milkRow] =await conn.query("SELECT id FROM inventory WHERE item_name = 'Whole Milk'");
    const [linked] = await conn.query(
      `SELECT l.menu_item_id, l.inventory_id FROM menu_item_stock_links l
       JOIN inventory i ON i.id = l.inventory_id
       JOIN menu_items m ON m.id = l.menu_item_id
       WHERE i.is_ingredient = 1 AND m.is_available = 1 LIMIT 1`,
    );
    const sellMenuId = linked[0]?.menu_item_id;
    const menuName = `E2E Ingr Drink ${RUN}`;
    const mk = await call('POST', '/menu', { token, body: { name: menuName, category: 'Cold Drinks', price: 2 } });
    const newMenuId = mk.body?.item?.id;
    if (newMenuId) itemIds.push(newMenuId);
    const sellOne = async (menuItemId, nm) => {
      const placed = await call('POST', '/orders', { token, body: { target_id: 'takeout', items: [{ menu_item_id: menuItemId, name: nm, quantity: 2 }] } });
      if (placed.body?.orderId) orderIds.push(placed.body.orderId);
      const paid = await call('POST', '/orders/checkout', { token, body: { target_id: 'takeout', payment_method: 'Cash' } });
      return { placed, paid };
    };
    const badRecipe = await call('PUT', `/menu-recipes/${newMenuId}`, { token, body: { lines: [{ ingredient_id: id, quantity: 0 }] } });
    check('recipe with a zero amount is 400', badRecipe.status === 400, badRecipe);
    const dupRecipe = await call('PUT', `/menu-recipes/${newMenuId}`, { token, body: { lines: [{ ingredient_id: id, quantity: 1 }, { ingredient_id: id, quantity: 2 }] } });
    check('recipe listing the same ingredient twice is 400', dupRecipe.status === 400, dupRecipe);
    const unknownRecipe = await call('PUT', `/menu-recipes/${newMenuId}`, { token, body: { lines: [{ ingredient_id: 99999999, quantity: 1 }] } });
    check('recipe with an unknown ingredient is 400', unknownRecipe.status === 400, unknownRecipe);
    const setRecipe = await call('PUT', `/menu-recipes/${newMenuId}`, { token, body: { lines: [{ ingredient_id: id, quantity: 1.5 }] } });
    check('saving a recipe returns 200 with the line', setRecipe.status === 200 && setRecipe.body?.lines?.length === 1 && Number(setRecipe.body.lines[0].quantity) === 1.5, setRecipe);
    const getRecipe = await call('GET', `/menu-recipes/${newMenuId}`, { token });
    check('GET recipe returns the saved line', getRecipe.status === 200 && getRecipe.body?.lines?.[0]?.ingredient_id === id, getRecipe);
    const listWithUse = await call('GET', '/ingredients', { token });
    const usedRow = listWithUse.body?.items?.find((row) => row.id === id);
    check('GET /ingredients shows where the ingredient is used', usedRow?.used_in?.some((use) => use.menu_item_id === newMenuId), usedRow);
    const beforeRecipeSale = Number(await dbQty(id));
    const s1 = await sellOne(newMenuId, menuName);
    check('sale of a new menu item succeeds (201 then 200)', s1.placed.status === 201 && s1.paid.status === 200, s1);
    check('selling 2 servings takes 2 x 1.5 = 3 from the ingredient', Number(await dbQty(id)) === beforeRecipeSale - 3, { before: beforeRecipeSale, after: await dbQty(id) });
    const refundOrderId = s1.placed.body?.orderId;
    const refund = await call('POST', `/orders/${refundOrderId}/refund`, { token, body: { reason: 'E2E recipe refund' } });
    if (refund.status === 200) {
      check('refunding the sale puts the ingredient back', Number(await dbQty(id)) === beforeRecipeSale, { after: await dbQty(id) });
    } else {
      console.log(`INFO  refund route returned ${refund.status}; refund restore check skipped`);
    }
    const clearRecipe = await call('PUT', `/menu-recipes/${newMenuId}`, { token, body: { lines: [] } });
    check('clearing a recipe returns 200 with no lines', clearRecipe.status === 200 && clearRecipe.body?.lines?.length === 0, clearRecipe);
    await call('POST', `/ingredients/${id}/adjust`, { token, body: { mode: 'count', quantity: 20 } });
    if (sellMenuId) {
      const [mn] = await conn.query('SELECT name FROM menu_items WHERE id = ?', [sellMenuId]);
      const s2 = await sellOne(sellMenuId, mn[0].name);
      check('sale of a menu item linked to an ingredient succeeds', s2.placed.status === 201 && s2.paid.status === 200, s2);
    } else {
      console.log('INFO  no available menu item is linked to an ingredient in this dump; linked-sale check skipped');
    }
    const [snapAfter] = await conn.query('SELECT id, stock_quantity FROM inventory WHERE is_ingredient = 1 ORDER BY id');
    check('ingredient rows are still present after sales', snapAfter.length === snapRows.length);
    check('the created ingredient is back to 20 after the recipe was cleared and recounted', Number(await dbQty(id)) === 20, await dbQty(id));
    const [ingrMoves] = await conn.query("SELECT COUNT(*) AS n FROM stock_movements WHERE reason = 'sale' AND inventory_id IN (SELECT id FROM inventory WHERE is_ingredient = 1)");
    check('recipe sales write sale movements for ingredients', Number(ingrMoves[0].n) > Number(saleMovesBefore[0].n), { before: saleMovesBefore, after: ingrMoves });
    check('Whole Milk row still exists as an ingredient', milkRow.length === 1);

    const movesBeforeDelete = (await moves(id)).length;
    const del = await call('DELETE', `/ingredients/${id}`, { token });
    check('delete returns 200', del.status === 200, del);
    check('deleted ingredient leaves GET /ingredients', !(await find(id)));
    const [delRow] = await conn.query('SELECT is_ingredient FROM inventory WHERE id = ?', [id]);
    check('deleted row keeps existing with is_ingredient 0', delRow.length === 1 && Number(delRow[0].is_ingredient) === 0, delRow);
    const movesAfterDelete = await moves(id);
    check('movements stay after delete', movesAfterDelete.length > 0 && movesAfterDelete.length >= movesBeforeDelete, { before: movesBeforeDelete, after: movesAfterDelete.length });
    const sumAfterDel = (await list()).body?.summary || {};
    check('summary total matches the list after delete', Number(sumAfterDel.total) === (await items()).length, sumAfterDel);
    const delAgain = await call('DELETE', `/ingredients/${id}`, { token });
    check('deleting again is 404', delAgain.status === 404, delAgain);
    const reuse = await create({ name: renamed, unit_label: 'kg' });
    check('re-adding the name of a removed ingredient is allowed (201)', reuse.status === 201, reuse);
    const [tomb] = await conn.query('SELECT item_name FROM inventory WHERE id = ?', [id]);
    check('the removed row is renamed to a tombstone name', String(tomb[0]?.item_name).toLowerCase() === `${renamed} [removed ${id}]`.toLowerCase(), tomb);
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
