const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5613;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'stocktest_admin';
const ADMIN_PASS = 'Stock-Test-Only-9!';
const CASHIER_USER = 'stocktest_cashier';
const CASHIER_PASS = 'Cashier-Test-1x';
const RUN = Date.now().toString(36);
const MILK_NAME = 'Test Milk';

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
    ['Stock Test Admin', ADMIN_USER, adminHash],
  );
  const cashierHash = await bcrypt.hash(CASHIER_PASS, 10);
  await conn.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
     VALUES (?, ?, ?, 'Cashier', '[]', 1, 0)`,
    ['Stock Test Cashier', CASHIER_USER, cashierHash],
  );
}

async function cleanup(conn, itemIds, orderIds) {
  const steps = [];
  if (orderIds.length) {
    steps.push(['DELETE FROM stock_movements WHERE order_id IN (?)', [orderIds]]);
    steps.push(['DELETE FROM order_items WHERE order_id IN (?)', [orderIds]]);
    steps.push(['DELETE FROM orders WHERE id IN (?)', [orderIds]]);
  }
  steps.push(['DELETE FROM stock_movements WHERE inventory_id IN (SELECT id FROM inventory WHERE item_name LIKE ?)', [`E2E Stock%${RUN}%`]]);
  steps.push(['DELETE FROM menu_item_stock_links WHERE inventory_id IN (SELECT id FROM inventory WHERE item_name LIKE ?)', [`E2E Stock%${RUN}%`]]);
  steps.push(['DELETE FROM inventory WHERE item_name LIKE ?', [`E2E Stock%${RUN}%`]]);
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
    check('server migrations created inventory.archived_at and the other columns', ready);
    if (!ready) return;
    await seedUsers(conn);

    const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
    check('admin login returns 200 and a token', adminLogin.status === 200 && !!adminLogin.body?.token, adminLogin);
    const token = adminLogin.body?.token;
    const cashierLogin = await login(CASHIER_USER, CASHIER_PASS);
    check('cashier login returns 200 and a token', cashierLogin.status === 200 && !!cashierLogin.body?.token, cashierLogin);
    const cashierToken = cashierLogin.body?.token;
    if (!token || !cashierToken) return;

    const createItem = async (name, category, price) => {
      const r = await call('POST', '/menu', { token, body: { name, category, price } });
      const id = r.body?.item?.id;
      if (id) itemIds.push(id);
      return { ...r, id };
    };
    const menuRow = async (id) => {
      const r = await call('GET', '/menu', { token });
      return Array.isArray(r.body) ? r.body.find((i) => i.id === id) : undefined;
    };
    const listStock = () => call('GET', '/inventory/menu-stock', { token });
    const stockRow = async (id) => {
      const r = await listStock();
      return (r.body?.items || []).find((i) => i.menu_item_id === id);
    };
    const track = (id, body) => call('POST', `/inventory/menu-stock/${id}/track`, { token, body });
    const restock = (id, body) => call('POST', `/inventory/menu-stock/${id}/restock`, { token, body });
    const settings = (id, body) => call('PATCH', `/inventory/menu-stock/${id}/settings`, { token, body });
    const untrack = (id) => call('POST', `/inventory/menu-stock/${id}/untrack`, { token });
    const sell = async (menuItemId, name, quantity, checkout = true) => {
      const placed = await call('POST', '/orders', {
        token,
        body: { target_id: 'takeout', items: [{ menu_item_id: menuItemId, name, quantity }] },
      });
      if (placed.body?.orderId) orderIds.push(placed.body.orderId);
      if (!checkout) return { placed };
      const paid = await call('POST', '/orders/checkout', {
        token,
        body: { target_id: 'takeout', payment_method: 'Cash' },
      });
      return { placed, paid };
    };
    const invList = async (query = '') => {
      const r = await call('GET', `/inventory${query}`, { token });
      return Array.isArray(r.body) ? r.body : [];
    };

    const [milkRows] = await conn.query('SELECT id, archived_at FROM inventory WHERE item_name = ?', [MILK_NAME]);
    const milkId = milkRows[0]?.id;
    check('fixture row Test Milk exists in the database', !!milkId, milkRows);
    check('startup migration archived Test Milk (archived_at set)', !!milkRows[0]?.archived_at, milkRows);
    const [milkLinks] = await conn.query('SELECT menu_item_id FROM menu_item_stock_links WHERE inventory_id = ?', [milkId]);
    check('fixture Test Milk has links to two menu items', milkLinks.length === 2, milkLinks);
    const activeInv = await invList();
    check('GET /inventory omits archived Test Milk', !activeInv.some((r) => r.id === milkId));
    const allInv = await invList('?include_archived=1');
    check('GET /inventory?include_archived=1 includes Test Milk', allInv.some((r) => r.id === milkId));
    const stockLevels = await call('GET', '/orders/stock-levels', { token });
    const levelsText = JSON.stringify(stockLevels.body);
    check('GET /orders/stock-levels succeeds and does not mention Test Milk', stockLevels.status === 200 && !levelsText.includes(MILK_NAME), stockLevels.status);

    const [beerCandidates] = await conn.query(
      `SELECT i.id, i.item_name, i.archived_at
       FROM inventory i
       JOIN menu_item_stock_links l ON l.inventory_id = i.id
       WHERE i.category = 'Beer'
       GROUP BY i.id, i.item_name, i.archived_at
       HAVING COUNT(DISTINCT l.menu_item_id) = 1 AND MIN(l.quantity_per_unit) = 1 AND MAX(l.quantity_per_unit) = 1`,
    );
    check('dump contains 1:1 beer rows linked at quantity 1', beerCandidates.length > 0, beerCandidates.length);
    check('1:1 beer rows stay un-archived', beerCandidates.every((r) => r.archived_at === null), beerCandidates.filter((r) => r.archived_at !== null));
    check('1:1 beer rows appear in GET /inventory', beerCandidates.every((r) => activeInv.some((a) => a.id === r.id)));

    const [archivedCount] = await conn.query(
      `SELECT COUNT(*) AS n FROM inventory i WHERE i.archived_at IS NULL AND EXISTS (
         SELECT 1 FROM menu_item_stock_links l WHERE l.inventory_id = i.id AND l.quantity_per_unit <> 1)`,
    );
    check('no un-archived row has a link with quantity_per_unit other than 1', Number(archivedCount[0].n) === 0, archivedCount);

    const milkMenuId = milkLinks[0]?.menu_item_id;
    const [milkMenuRows] = await conn.query('SELECT id, name, is_available FROM menu_items WHERE id = ?', [milkMenuId]);
    const milkMenuName = milkMenuRows[0]?.name;
    const [milkBefore] = await conn.query('SELECT stock_quantity FROM inventory WHERE id = ?', [milkId]);
    const milkSale = await sell(milkMenuId, milkMenuName, 1);
    check('selling a menu item linked to archived Test Milk succeeds', milkSale.placed.status === 201 && milkSale.paid?.status === 200, { placed: milkSale.placed, paid: milkSale.paid });
    const [milkAfter] = await conn.query('SELECT stock_quantity FROM inventory WHERE id = ?', [milkId]);
    check('a sale now deducts the Test Milk ingredient by its recipe amount (0.2)', Math.abs(Number(milkBefore[0].stock_quantity) - Number(milkAfter[0].stock_quantity) - 0.2) < 1e-9, { before: milkBefore, after: milkAfter });
    const [milkMoves] = await conn.query('SELECT COUNT(*) AS n FROM stock_movements WHERE inventory_id = ?', [milkId]);
    check('one sale movement recorded for the Test Milk ingredient', Number(milkMoves[0].n) === 1, milkMoves);
    const menuAll = await call('GET', '/menu', { token });
    const milkMenuApi = Array.isArray(menuAll.body) ? menuAll.body.find((i) => i.id === milkMenuId) : undefined;
    check('GET /menu stock fields ignore archived Test Milk', !!milkMenuApi && (milkMenuApi.stock_left === null || milkMenuApi.stock_left === undefined || Number(milkMenuApi.stock_left) !== Number(milkAfter[0].stock_quantity)), milkMenuApi);

    const noTokenList = await call('GET', '/inventory/menu-stock');
    check('no token gets 401 on GET menu-stock', noTokenList.status === 401, noTokenList);
    const cList = await call('GET', '/inventory/menu-stock', { token: cashierToken });
    check('Cashier without inventory_stock gets 403 on GET menu-stock', cList.status === 403, cList);

    const name = `E2E Stock ${RUN}`;
    const item = await createItem(name, 'Cold Drinks', 2.5);
    check('menu item for stock tests created (201)', item.status === 201 && !!item.id, item);
    const id = item.id;
    if (!id) return;

    const noTokenTrack = await call('POST', `/inventory/menu-stock/${id}/track`, { body: { quantity: 1 } });
    check('no token gets 401 on track', noTokenTrack.status === 401, noTokenTrack);
    const cTrack = await call('POST', `/inventory/menu-stock/${id}/track`, { token: cashierToken, body: { quantity: 1 } });
    check('Cashier gets 403 on track', cTrack.status === 403, cTrack);
    const cRestock = await call('POST', `/inventory/menu-stock/${id}/restock`, { token: cashierToken, body: { mode: 'set', quantity: 1 } });
    check('Cashier gets 403 on restock', cRestock.status === 403, cRestock);
    const cSettings = await call('PATCH', `/inventory/menu-stock/${id}/settings`, { token: cashierToken, body: { low_threshold: 1 } });
    check('Cashier gets 403 on settings', cSettings.status === 403, cSettings);
    const cUntrack = await call('POST', `/inventory/menu-stock/${id}/untrack`, { token: cashierToken });
    check('Cashier gets 403 on untrack', cUntrack.status === 403, cUntrack);

    const list0 = await listStock();
    check('GET menu-stock returns 200 with items and summary', list0.status === 200 && Array.isArray(list0.body?.items) && !!list0.body?.summary, list0);
    const untrackedRow = (list0.body?.items || []).find((i) => i.menu_item_id === id);
    check(
      'new item is listed untracked with null stock',
      untrackedRow?.tracked === false && untrackedRow?.stock_quantity === null && untrackedRow?.inventory_id === null,
      untrackedRow,
    );
    const sum0 = list0.body?.summary || {};
    check('summary total equals tracked + untracked', Number(sum0.total) === Number(sum0.tracked) + Number(sum0.untracked), sum0);
    check('list never includes archived Test Milk as a tracked row', !(list0.body?.items || []).some((i) => i.name === MILK_NAME));

    const notTracked = await restock(id, { mode: 'set', quantity: 5 });
    check('restock on an untracked item is 409 not_tracked', notTracked.status === 409 && notTracked.body?.code === 'not_tracked', notTracked);
    const notTrackedSettings = await settings(id, { low_threshold: 3 });
    check('settings on an untracked item is 409 not_tracked', notTrackedSettings.status === 409 && notTrackedSettings.body?.code === 'not_tracked', notTrackedSettings);
    const notTrackedUntrack = await untrack(id);
    check('untrack on an untracked item is 409 not_tracked', notTrackedUntrack.status === 409 && notTrackedUntrack.body?.code === 'not_tracked', notTrackedUntrack);

    const unknownTrack = await track(99999999, { quantity: 5 });
    check('track unknown menu item is 404', unknownTrack.status === 404, unknownTrack);
    const negTrack = await track(id, { quantity: -1 });
    check('track with negative quantity is 400', negTrack.status === 400, negTrack);
    const badPack = await track(id, { quantity: 5, pack_size: 1 });
    check('track with pack_size 1 is 400', badPack.status === 400, badPack);
    const longLabel = await track(id, { quantity: 5, unit_label: 'x'.repeat(21) });
    check('track with unit_label over 20 chars is 400', longLabel.status === 400, longLabel);
    const stillUntracked = await stockRow(id);
    check('invalid track attempts leave the item untracked', stillUntracked?.tracked === false, stillUntracked);

    const tracked = await track(id, { quantity: 20 });
    check('track with 20 portions returns 201 with item', tracked.status === 201 && !!tracked.body?.item, tracked);
    check(
      'tracked item has quantity 20, status IN_STOCK and an inventory id',
      Number(tracked.body?.item?.stock_quantity) === 20 && tracked.body?.item?.stock_status === 'IN_STOCK' && tracked.body?.item?.tracked === true && !!tracked.body?.item?.inventory_id,
      tracked.body,
    );
    const inventoryId = tracked.body?.item?.inventory_id;
    const dup = await track(id, { quantity: 20 });
    check('tracking twice is 409 already_tracked', dup.status === 409 && dup.body?.code === 'already_tracked', dup);
    const listed = await stockRow(id);
    check('list shows the item tracked with quantity 20', listed?.tracked === true && Number(listed?.stock_quantity) === 20, listed);
    const sum1 = (await listStock()).body?.summary || {};
    check('summary tracked count grew by one', Number(sum1.tracked) === Number(sum0.tracked) + 1 && Number(sum1.untracked) === Number(sum0.untracked) - 1, { sum0, sum1 });

    const setRes = await restock(id, { mode: 'set', quantity: 12 });
    check('restock set 12 returns 200 and quantity 12', setRes.status === 200 && Number(setRes.body?.item?.stock_quantity) === 12, setRes);
    const addRes = await restock(id, { mode: 'add', quantity: 5 });
    check('restock add 5 returns 200 and quantity 17', addRes.status === 200 && Number(addRes.body?.item?.stock_quantity) === 17, addRes);
    const badMode = await restock(id, { mode: 'multiply', quantity: 5 });
    check('restock with unknown mode is 400', badMode.status === 400, badMode);
    const negRestock = await restock(id, { mode: 'set', quantity: -3 });
    check('restock set with negative quantity is 400', negRestock.status === 400, negRestock);

    const noPack = await restock(id, { mode: 'add', packs: 2 });
    check('add with packs and no pack_size is 400 no_pack_size', noPack.status === 400 && noPack.body?.code === 'no_pack_size', noPack);
    const qtyAfterNoPack = await stockRow(id);
    check('failed pack restock leaves quantity 17', Number(qtyAfterNoPack?.stock_quantity) === 17, qtyAfterNoPack);

    const setPack = await settings(id, { pack_size: 24 });
    check('settings pack_size 24 returns 200', setPack.status === 200 && Number(setPack.body?.item?.pack_size) === 24, setPack);
    const packAdd = await restock(id, { mode: 'add', packs: 2 });
    check('add 2 packs of 24 raises quantity from 17 to 65', packAdd.status === 200 && Number(packAdd.body?.item?.stock_quantity) === 65, packAdd);
    const packOne = await restock(id, { mode: 'add', packs: 1 });
    check('add 1 pack raises quantity by 24 to 89', packOne.status === 200 && Number(packOne.body?.item?.stock_quantity) === 89, packOne);
    const badPackSettings = await settings(id, { pack_size: 1 });
    check('settings pack_size 1 is 400', badPackSettings.status === 400, badPackSettings);
    const longLabelSettings = await settings(id, { unit_label: 'y'.repeat(21) });
    check('settings unit_label over 20 chars is 400', longLabelSettings.status === 400, longLabelSettings);
    await restock(id, { mode: 'set', quantity: 17 });

    const removeMistake = await restock(id, { mode: 'remove', quantity: 2, reason: 'mistake' });
    check('remove 2 (entered by mistake) lowers quantity from 17 to 15', removeMistake.status === 200 && Number(removeMistake.body?.item?.stock_quantity) === 15, removeMistake);
    const removeWaste = await restock(id, { mode: 'remove', quantity: 3, reason: 'waste' });
    check('remove 3 (spoiled) lowers quantity from 15 to 12', removeWaste.status === 200 && Number(removeWaste.body?.item?.stock_quantity) === 12, removeWaste);
    const removeTooMany = await restock(id, { mode: 'remove', quantity: 999, reason: 'mistake' });
    check('remove more than on hand is 400 exceeds_stock', removeTooMany.status === 400 && removeTooMany.body?.code === 'exceeds_stock', removeTooMany);
    const removeNoReason = await restock(id, { mode: 'remove', quantity: 1 });
    check('remove without a reason is 400 invalid_reason', removeNoReason.status === 400 && removeNoReason.body?.code === 'invalid_reason', removeNoReason);
    const removeZero = await restock(id, { mode: 'remove', quantity: 0, reason: 'mistake' });
    check('remove 0 is 400', removeZero.status === 400, removeZero);
    const [removeMoves] = await conn.query("SELECT reason, change_amount, note FROM stock_movements WHERE inventory_id = ? AND note LIKE 'Removed:%' ORDER BY id", [inventoryId]);
    check('remove writes a history entry per removal with the reason note', removeMoves.length === 2 && removeMoves[0].reason === 'adjustment' && Number(removeMoves[0].change_amount) === -2 && removeMoves[1].reason === 'waste' && Number(removeMoves[1].change_amount) === -3, removeMoves);
    await restock(id, { mode: 'set', quantity: 17 });

    const sale = await sell(id, name, 3);
    check('order of 3 portions placed (201) and paid (200)', sale.placed.status === 201 && sale.paid?.status === 200, { placed: sale.placed, paid: sale.paid });
    const afterSale = await stockRow(id);
    check('real sale of 3 decrements stock 17 to 14', Number(afterSale?.stock_quantity) === 14, afterSale);
    const menuAfterSale = await menuRow(id);
    check('GET /menu shows stock_left 14', Number(menuAfterSale?.stock_left) === 14, menuAfterSale);
    const [saleMoves] = await conn.query("SELECT change_amount FROM stock_movements WHERE inventory_id = ? AND reason = 'sale'", [inventoryId]);
    check('a sale movement of -3 was recorded', saleMoves.length === 1 && Number(saleMoves[0].change_amount) === -3, saleMoves);

    const hold = await sell(id, name, 2, false);
    check('order of 2 placed without checkout (201)', hold.placed.status === 201, hold.placed);
    const afterHold = await stockRow(id);
    console.log(`INFO  pending order of 2 leaves stock at ${afterHold?.stock_quantity}`);
    const removeLine = await call('PUT', '/orders/items', { token, body: { target_id: 'takeout', items: [] } });
    check('removing the pending order lines returns 200', removeLine.status === 200, removeLine);
    const afterRemove = await stockRow(id);
    check(
      'removing the pending line returns stock to 14',
      Number(afterRemove?.stock_quantity) === 14,
      { afterHold: afterHold?.stock_quantity, afterRemove: afterRemove?.stock_quantity },
    );

    const label = await settings(id, { unit_label: 'cans', low_threshold: 14 });
    check('settings change unit_label and low_threshold returns 200', label.status === 200 && label.body?.item?.unit_label === 'cans' && Number(label.body?.item?.low_threshold) === 14, label);
    const lowRow = await stockRow(id);
    check('quantity 14 with low_threshold 14 reports LOW_STOCK', lowRow?.stock_status === 'LOW_STOCK', lowRow);
    const lowList = await listStock();
    check('summary low count includes the item', Number(lowList.body?.summary?.low) >= 1, lowList.body?.summary);
    const relax = await settings(id, { low_threshold: 5 });
    check('lowering low_threshold to 5 returns 200', relax.status === 200, relax);
    const okRow = await stockRow(id);
    check('quantity 14 with low_threshold 5 reports IN_STOCK', okRow?.stock_status === 'IN_STOCK', okRow);

    const [untrackedRows] = await conn.query(
      `SELECT m.id, m.name FROM menu_items m WHERE m.is_available = 1 AND NOT EXISTS (
         SELECT 1 FROM menu_item_stock_links l JOIN inventory i ON i.id = l.inventory_id AND i.archived_at IS NULL
         WHERE l.menu_item_id = m.id) ORDER BY m.id LIMIT 1`,
    );
    const plain = untrackedRows[0];
    const offUnlimited = await call('PATCH', `/inventory/menu-stock/${plain.id}/unlimited`, { token, body: { unlimited: false } });
    check('PATCH unlimited false returns 200 and stock_unlimited false', offUnlimited.status === 200 && offUnlimited.body?.item?.stock_unlimited === false, offUnlimited);
    const noStockSale = await sell(plain.id, plain.name, 1);
    check('an item with no stock and not unlimited is refused with 409 not_stocked', noStockSale.placed.status === 409 && noStockSale.placed.body?.code === 'not_stocked', noStockSale.placed);
    const menuNoStock = (await call('GET', '/menu', { token })).body.find((m) => m.id === plain.id);
    check('GET /menu marks it stock_tracked false and stock_unlimited false', menuNoStock?.stock_tracked === false && menuNoStock?.stock_unlimited === false, menuNoStock);
    const onUnlimited = await call('PATCH', `/inventory/menu-stock/${plain.id}/unlimited`, { token, body: { unlimited: true } });
    check('PATCH unlimited true returns 200', onUnlimited.status === 200 && onUnlimited.body?.item?.stock_unlimited === true, onUnlimited);
    const unlimitedSale = await sell(plain.id, plain.name, 1);
    check('the same item sells once marked unlimited', unlimitedSale.placed.status === 201, unlimitedSale.placed);
    const badUnlimited = await call('PATCH', `/inventory/menu-stock/${plain.id}/unlimited`, { token, body: { unlimited: 'yes' } });
    check('PATCH unlimited with a non-boolean is 400', badUnlimited.status === 400, badUnlimited);

    const over = await sell(id, name, 20);
    check('ordering 20 when only 14 are left is refused with 409 insufficient_stock', over.placed.status === 409 && over.placed.body?.code === 'insufficient_stock', over.placed);
    const afterOver = await stockRow(id);
    check('a refused order leaves the stock at 14', Number(afterOver?.stock_quantity) === 14, afterOver);
    const exact = await sell(id, name, 14);
    check('ordering exactly the 14 left is accepted', exact.placed.status === 201 && exact.paid?.status === 200, exact);
    const afterExact = await stockRow(id);
    check('selling the last 14 leaves 0 and OUT_OF_STOCK', Number(afterExact?.stock_quantity) === 0 && afterExact?.stock_status === 'OUT_OF_STOCK', afterExact);
    const none = await sell(id, name, 1);
    check('ordering 1 when 0 are left is refused with 409', none.placed.status === 409, none.placed);
    await restock(id, { mode: 'set', quantity: 9 });

    const [invRow] = await conn.query('SELECT archived_at FROM inventory WHERE id = ?', [inventoryId]);
    check('tracked inventory row is not archived before untrack', invRow[0]?.archived_at === null, invRow);
    const inListBefore = (await invList()).some((r) => r.id === inventoryId);
    check('GET /inventory includes the tracked row', inListBefore);
    const un = await untrack(id);
    check('untrack returns 200', un.status === 200, un);
    const afterUn = await stockRow(id);
    check('after untrack the list shows untracked with null stock', afterUn?.tracked === false && afterUn?.stock_quantity === null, afterUn);
    const [archRow] = await conn.query('SELECT archived_at FROM inventory WHERE id = ?', [inventoryId]);
    check('untrack archives the inventory row (kept in the database)', !!archRow[0]?.archived_at, archRow);
    check('GET /inventory no longer lists the untracked row', !(await invList()).some((r) => r.id === inventoryId));
    check('GET /inventory?include_archived=1 still lists the row', (await invList('?include_archived=1')).some((r) => r.id === inventoryId));
    const [kept] = await conn.query('SELECT COUNT(*) AS n FROM stock_movements WHERE inventory_id = ?', [inventoryId]);
    check('movement history is kept after untrack', Number(kept[0].n) > 0, kept);
    const menuAfterUn = await menuRow(id);
    check('GET /menu stock_left is empty after untrack', menuAfterUn?.stock_left === null || menuAfterUn?.stock_left === undefined, menuAfterUn);
    const levelsAfter = await call('GET', '/orders/stock-levels', { token });
    check('stock-levels succeeds after untrack', levelsAfter.status === 200, levelsAfter.status);
    const secondUntrack = await untrack(id);
    check('untracking again is 409 not_tracked', secondUntrack.status === 409 && secondUntrack.body?.code === 'not_tracked', secondUntrack);

    const retrack = await track(id, { quantity: 4 });
    check('an untracked item can be tracked again (201)', retrack.status === 201 && Number(retrack.body?.item?.stock_quantity) === 4, retrack);

    const delName = `E2E Stock Del ${RUN}`;
    const delItem = await createItem(delName, 'Cold Drinks', 1.5);
    const delTrack = await track(delItem.id, { quantity: 6 });
    check('item to delete is tracked (201)', delTrack.status === 201, delTrack);
    const delInvId = delTrack.body?.item?.inventory_id;
    const delRes = await call('DELETE', `/menu/${delItem.id}`, { token });
    check('deleting a tracked menu item without sales returns 200', delRes.status === 200, delRes);
    const [delInv] = await conn.query('SELECT archived_at FROM inventory WHERE id = ?', [delInvId]);
    check('deleting the menu item archives its inventory row instead of orphaning it', delInv.length === 1 && !!delInv[0].archived_at, delInv);
    check('archived row of the deleted item is hidden from GET /inventory', !(await invList()).some((r) => r.id === delInvId));
    const listAfterDelete = await listStock();
    check('deleted item is gone from menu-stock list', listAfterDelete.status === 200 && !(listAfterDelete.body?.items || []).some((i) => i.menu_item_id === delItem.id), listAfterDelete.status);
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
