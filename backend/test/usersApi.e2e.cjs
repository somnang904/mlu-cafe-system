const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5611;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'roletest';
const ADMIN_PASS = 'Role-Test-Only-9!';
const CASHIER_PASS = 'Cashier-Test-1x';
const NEW_PASS = 'Cashier-Changed-2y';
const created = new Set([ADMIN_USER, 'roletest2']);

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

async function seedAdmin(conn) {
  const wanted = ['is_active', 'must_change_password', 'tokens_valid_after'];
  for (let i = 0; i < 60; i += 1) {
    const [cols] = await conn.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [DB_NAME, 'users'],
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (wanted.every((c) => have.has(c))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  await conn.execute('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
  await conn.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
     VALUES (?, ?, ?, 'Admin', '[]', 1, 0)`,
    ['Role Test Admin', ADMIN_USER, hash],
  );
}

async function cleanup(conn) {
  for (const name of created) {
    try {
      const [rows] = await conn.execute('SELECT id FROM users WHERE username = ?', [name]);
      for (const row of rows) {
        const related = [
          ['user_sessions', 'user_id'],
          ['admin_notifications', 'recipient_user_id'],
        ];
        for (const [table, col] of related) {
          try {
            await conn.execute(`DELETE FROM ${table} WHERE ${col} = ?`, [row.id]);
          } catch {
            continue;
          }
        }
        await conn.execute('DELETE FROM users WHERE id = ?', [row.id]);
      }
    } catch (error) {
      console.log(`WARN  cleanup of ${name} failed: ${error.message}`);
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

  try {
    await seedAdmin(conn);

    const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
    check('admin login returns 200 and a token', adminLogin.status === 200 && !!adminLogin.body?.token, adminLogin);
    let adminToken = adminLogin.body?.token;
    const adminId = adminLogin.body?.user?.id;
    if (!adminToken) return;

    const list = await call('GET', '/users', { token: adminToken });
    const first = Array.isArray(list.body) ? list.body[0] : null;
    check(
      'GET /users returns is_active and has_history on each row',
      list.status === 200 && !!first && typeof first.is_active === 'boolean' && typeof first.has_history === 'boolean',
      list,
    );
    const selfRow = Array.isArray(list.body) ? list.body.find((u) => u.id === adminId) : null;
    check('GET /users: admin who has logged in has has_history true', selfRow?.has_history === true, selfRow);

    const makeCashier = (username, display_name = 'Test Cashier') =>
      call('POST', '/users', {
        token: adminToken,
        body: { display_name, username, password: CASHIER_PASS, role: 'Cashier', permissions: [] },
      });

    created.add('wrongname_tmp');
    const c1 = await makeCashier('wrongname_tmp', 'Fixed One');
    check('create Cashier returns 201 with id', c1.status === 201 && !!c1.body?.id, c1);
    const c1Id = c1.body?.id;

    const c1Login = await login('wrongname_tmp', CASHIER_PASS);
    check(
      'new cashier signs straight in: login reports must_change_password false',
      c1Login.status === 200 && c1Login.body?.user?.must_change_password === false,
      c1Login,
    );
    let c1Token = c1Login.body?.token;

    const heldOnPasswordScreen = (r) => r.status === 403 && r.body?.code === 'PASSWORD_CHANGE_REQUIRED';
    const newUsers = await call('GET', '/users', { token: c1Token });
    check('new cashier: GET /users is not held on the change-password screen', !heldOnPasswordScreen(newUsers), newUsers);
    const newMenu = await call('GET', '/menu', { token: c1Token });
    check('new cashier: GET /menu is not held on the change-password screen', !heldOnPasswordScreen(newMenu), newMenu);
    const newOrders = await call('GET', '/orders', { token: c1Token });
    check('new cashier: GET /orders is not held on the change-password screen', !heldOnPasswordScreen(newOrders), newOrders);

    // A flag left on a cashier row by an older version must not hold them either.
    await conn.execute('UPDATE users SET must_change_password = 1 WHERE id = ?', [c1Id]);
    const legacyLogin = await login('wrongname_tmp', CASHIER_PASS);
    check(
      'a cashier row with a stale flag still signs straight in',
      legacyLogin.status === 200 && legacyLogin.body?.user?.must_change_password === false,
      legacyLogin,
    );
    const legacyMenu = await call('GET', '/menu', { token: legacyLogin.body?.token });
    check('a cashier row with a stale flag is not held on the change-password screen', !heldOnPasswordScreen(legacyMenu), legacyMenu);

    const changed = await call('POST', '/auth/change-password', {
      token: c1Token,
      body: { currentPassword: CASHIER_PASS, password: NEW_PASS, confirmPassword: NEW_PASS },
    });
    check('POST /auth/change-password succeeds with a new token', changed.status === 200 && !!changed.body?.token, changed);
    if (changed.body?.token) c1Token = changed.body.token;

    const afterChange = await call('GET', '/users', { token: c1Token });
    check(
      'after password change the PASSWORD_CHANGE_REQUIRED block is gone (plain 403, admin only)',
      afterChange.status === 403 && afterChange.body?.code !== 'PASSWORD_CHANGE_REQUIRED',
      afterChange,
    );
    const relogin = await login('wrongname_tmp', NEW_PASS);
    check(
      'login with the new password reports must_change_password false',
      relogin.status === 200 && relogin.body?.user?.must_change_password === false,
      relogin,
    );
    if (relogin.body?.token) c1Token = relogin.body.token;

    const renameBody = (extra) => ({ display_name: 'Fixed One', role: 'Cashier', permissions: [], ...extra });

    const renamed = await call('PUT', `/users/${c1Id}`, { token: adminToken, body: renameBody({ username: 'fixedone' }) });
    check(
      'rename Cashier "Fixed One" to fixedone returns 200',
      renamed.status === 200 && renamed.body?.user?.username === 'fixedone',
      renamed,
    );
    created.add('fixedone');

    const oldTokenUse = await call('GET', '/auth/me', { token: c1Token });
    check('old token is 401 after username change', oldTokenUse.status === 401, oldTokenUse);
    const oldNameLogin = await login('wrongname_tmp', NEW_PASS);
    check('login with the old username is 401', oldNameLogin.status === 401, oldNameLogin);
    const newNameLogin = await login('fixedone', NEW_PASS);
    check('login with the new username is 200', newNameLogin.status === 200 && !!newNameLogin.body?.token, newNameLogin);
    const c1NewToken = newNameLogin.body?.token;

    created.add('taken_probe');
    const c2 = await makeCashier('taken_probe', 'Probe User');
    check('create second Cashier for collision checks', c2.status === 201, c2);
    const c2Id = c2.body?.id;
    const probeBody = (extra) => renameBody({ display_name: 'Probe User', ...extra });

    const dup = await call('PUT', `/users/${c2Id}`, { token: adminToken, body: probeBody({ username: 'fixedone' }) });
    check('rename to a taken username is 400', dup.status === 400, dup);
    const tooShort = await call('PUT', `/users/${c2Id}`, { token: adminToken, body: probeBody({ username: 'ab' }) });
    check('rename to a too-short username is 400', tooShort.status === 400, tooShort);
    const badChars = await call('PUT', `/users/${c2Id}`, { token: adminToken, body: probeBody({ username: 'bad name!' }) });
    check('rename to a username with bad characters is 400', badChars.status === 400, badChars);

    const adminBody = (extra) => ({ display_name: 'Role Test Admin', username: ADMIN_USER, role: 'Admin', permissions: [], ...extra });

    const selfRename = await call('PUT', `/users/${adminId}`, { token: adminToken, body: adminBody({ username: 'roletest2' }) });
    check('admin renames self: 200 and a new token is returned', selfRename.status === 200 && !!selfRename.body?.token, selfRename);
    const oldAdminToken = adminToken;
    if (selfRename.body?.token) adminToken = selfRename.body.token;
    const newTokenWorks = await call('GET', '/users', { token: adminToken });
    check('admin new token works after self rename', newTokenWorks.status === 200, newTokenWorks);
    const oldAdminTokenUse = await call('GET', '/users', { token: oldAdminToken });
    check('admin old token is 401 after self rename', oldAdminTokenUse.status === 401, oldAdminTokenUse);
    const renameBack = await call('PUT', `/users/${adminId}`, { token: adminToken, body: adminBody() });
    check('admin renames back and receives a working token', renameBack.status === 200 && !!renameBack.body?.token, renameBack);
    if (renameBack.body?.token) adminToken = renameBack.body.token;
    const backWorks = await call('GET', '/users', { token: adminToken });
    check('admin token works after renaming back', backWorks.status === 200, backWorks);

    const demote = await call('PUT', `/users/${adminId}`, { token: adminToken, body: adminBody({ role: 'Cashier' }) });
    check('admin cannot be demoted (400)', demote.status === 400, demote);
    const disableSelf = await call('PUT', `/users/${adminId}`, { token: adminToken, body: adminBody({ is_active: false }) });
    check('admin cannot disable self (400)', disableSelf.status === 400, disableSelf);
    created.add('second_admin');
    const createAdmin = await call('POST', '/users', {
      token: adminToken,
      body: { display_name: 'Second Admin', username: 'second_admin', password: CASHIER_PASS, role: 'Admin', permissions: [] },
    });
    check('creating an Admin account is 400', createAdmin.status === 400, createAdmin);
    const promote = await call('PUT', `/users/${c2Id}`, { token: adminToken, body: probeBody({ role: 'Admin' }) });
    check('promoting a Cashier to Admin is 400', promote.status === 400, promote);

    const longName = await call('PUT', `/users/${c2Id}`, { token: adminToken, body: probeBody({ display_name: 'x'.repeat(101) }) });
    check('update with a 101 character display_name is 400', longName.status === 400, longName);
    const objName = await call('PUT', `/users/${c2Id}`, { token: adminToken, body: probeBody({ display_name: { a: 1 } }) });
    check('update with an object display_name is 400', objName.status === 400, objName);
    created.add('long_name_user');
    const createLong = await call('POST', '/users', {
      token: adminToken,
      body: { display_name: 'x'.repeat(101), username: 'long_name_user', password: CASHIER_PASS, role: 'Cashier', permissions: [] },
    });
    check('create with a 101 character display_name is 400', createLong.status === 400, createLong);
    created.add('obj_name_user');
    const createObj = await call('POST', '/users', {
      token: adminToken,
      body: { display_name: { a: 1 }, username: 'obj_name_user', password: CASHIER_PASS, role: 'Cashier', permissions: [] },
    });
    check('create with an object display_name is 400', createObj.status === 400, createObj);
    const createBadUser = await call('POST', '/users', {
      token: adminToken,
      body: { display_name: 'Bad User', username: 'bad user!', password: CASHIER_PASS, role: 'Cashier', permissions: [] },
    });
    check('create with a bad username is 400', createBadUser.status === 400, createBadUser);

    const delHistory = await call('DELETE', `/users/${c1Id}`, { token: adminToken });
    check(
      'account with history cannot be deleted (409 USER_HAS_HISTORY)',
      delHistory.status === 409 && delHistory.body?.code === 'USER_HAS_HISTORY',
      delHistory,
    );

    const disable = await call('PUT', `/users/${c1Id}`, { token: adminToken, body: renameBody({ username: 'fixedone', is_active: false }) });
    check('account with history can be disabled (200)', disable.status === 200 && disable.body?.user?.is_active === false, disable);
    const disabledLogin = await login('fixedone', NEW_PASS);
    check('disabled account login is 401', disabledLogin.status === 401, disabledLogin);
    const enable = await call('PUT', `/users/${c1Id}`, { token: adminToken, body: renameBody({ username: 'fixedone', is_active: true }) });
    check('disabled account can be re-enabled (200)', enable.status === 200 && enable.body?.user?.is_active === true, enable);
    const enabledLogin = await login('fixedone', NEW_PASS);
    check('re-enabled account login is 200', enabledLogin.status === 200, enabledLogin);

    const cashierToken = enabledLogin.body?.token || c1NewToken;
    const cGet = await call('GET', '/users', { token: cashierToken });
    check('Cashier token gets 403 on GET /users', cGet.status === 403, cGet);
    const cPut = await call('PUT', `/users/${c2Id}`, { token: cashierToken, body: probeBody() });
    check('Cashier token gets 403 on PUT /users/:id', cPut.status === 403, cPut);
    const cDel = await call('DELETE', `/users/${c2Id}`, { token: cashierToken });
    check('Cashier token gets 403 on DELETE /users/:id', cDel.status === 403, cDel);

    const noGet = await call('GET', '/users');
    check('no token gets 401 on GET /users', noGet.status === 401, noGet);
    const noPut = await call('PUT', `/users/${c2Id}`, { body: probeBody() });
    check('no token gets 401 on PUT /users/:id', noPut.status === 401, noPut);
    const noDel = await call('DELETE', `/users/${c2Id}`);
    check('no token gets 401 on DELETE /users/:id', noDel.status === 401, noDel);

    const delFresh = await call('DELETE', `/users/${c2Id}`, { token: adminToken });
    check('account with no history can be deleted (200)', delFresh.status === 200, delFresh);
    const goneLogin = await login('taken_probe', CASHIER_PASS);
    check('deleted account can no longer log in', goneLogin.status === 401, goneLogin);
  } finally {
    await cleanup(conn);
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
