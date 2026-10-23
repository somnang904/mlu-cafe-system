const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5611;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/api`;
const ADMIN_USER = 'sectest_admin';
const ADMIN_PASS = 'Sec-Test-Only-9!';
const CASHIER_USER = 'sectest_cashier';
const CASHIER_PASS = 'Cashier-Test-1x';
const VICTIM_USER = 'sectest_victim';
const VICTIM_PASS = 'Victim-Test-Only-9!';
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

async function call(method, path, { token, body, headers: extra, raw } = {}) {
  const headers = { ...(extra || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(raw ? `${ORIGIN}${path}` : `${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

const login = (username, password) => call('POST', '/auth/login', { body: { username, password } });
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

async function seed(conn) {
  for (const table of ['blocked_devices', 'login_attempts']) {
    try { await conn.query(`DELETE FROM ${table}`) } catch { /* table may not exist */ }
  }
  const users = [
    [ADMIN_USER, ADMIN_PASS, 'Admin', 'Security Test Admin'],
    [CASHIER_USER, CASHIER_PASS, 'Cashier', 'Security Test Cashier'],
    [VICTIM_USER, VICTIM_PASS, 'Cashier', 'Security Test Victim'],
  ];
  await conn.execute('DELETE FROM users WHERE username IN (?, ?, ?)', [ADMIN_USER, CASHIER_USER, VICTIM_USER]);
  for (const [username, password, role, name] of users) {
    const hash = await bcrypt.hash(password, 10);
    await conn.execute(
      `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
       VALUES (?, ?, ?, ?, '[]', 1, 0)`,
      [name, username, hash, role],
    );
  }
}

async function cleanup(conn, itemIds) {
  const steps = [
    ['DELETE FROM menu_items WHERE id IN (?)', [itemIds.length ? itemIds : [0]]],
    ['DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?, ?))', [ADMIN_USER, CASHIER_USER, VICTIM_USER]],
    ['DELETE FROM users WHERE username IN (?, ?, ?)', [ADMIN_USER, CASHIER_USER, VICTIM_USER]],
  ];
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
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: DB_NAME,
  });
  const itemIds = [];

  try {
    await seed(conn);

    // ---- 1. Authentication: protected routes need a token --------------------------------
    const protectedGets = [
      '/users', '/menu', '/orders/active', '/orders/history', '/inventory', '/ingredients',
      '/expenses', '/reports', '/tables', '/dashboard/live', '/alerts', '/security-alerts',
      '/system/backup/excel', '/system/backup/sql', '/system/backup/auto-status',
    ];
    for (const path of protectedGets) {
      const r = await call('GET', path);
      check(`1. no token -> 401 on GET ${path}`, r.status === 401, r.status);
    }

    // ---- 2. Authentication: login handling -----------------------------------------------
    const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
    check('2. valid admin login returns 200 and a token', adminLogin.status === 200 && !!adminLogin.body?.token, adminLogin.status);
    const cashierLogin = await login(CASHIER_USER, CASHIER_PASS);
    check('2. valid cashier login returns 200 and a token', cashierLogin.status === 200 && !!cashierLogin.body?.token, cashierLogin.status);
    const token = adminLogin.body?.token;
    const cashierToken = cashierLogin.body?.token;
    if (!token || !cashierToken) return;

    const wrongPass = await login(ADMIN_USER, 'definitely-wrong');
    const noUser = await login('no_such_user_' + RUN, 'definitely-wrong');
    check('2. wrong password is rejected (401)', wrongPass.status === 401, wrongPass.status);
    check('2. unknown user gets the same status and message as a wrong password (no user enumeration)',
      noUser.status === wrongPass.status && noUser.body?.message === wrongPass.body?.message, { a: noUser.body, b: wrongPass.body });
    check('2. login response never contains a password hash', !/password_hash|\$2[aby]\$/.test(adminLogin.text), 'hash leaked');

    const emptyLogin = await call('POST', '/auth/login', { body: {} });
    check('2. empty login body is rejected without a 500', emptyLogin.status >= 400 && emptyLogin.status < 500, emptyLogin.status);
    const arrayLogin = await call('POST', '/auth/login', { body: { username: ['a'], password: { $ne: '' } } });
    check('2. object/array credentials (NoSQL-style) are rejected without a 500', arrayLogin.status >= 400 && arrayLogin.status < 500, arrayLogin.status);

    // ---- 3. JWT tampering ----------------------------------------------------------------
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const forgedAdmin = `${h}.${b64({ ...payload, id: Number(payload.id) + 999 })}.${s}`;
    const cashierPayload = JSON.parse(Buffer.from(cashierToken.split('.')[1], 'base64url').toString());
    const elevated = `${cashierToken.split('.')[0]}.${b64({ ...cashierPayload, role: 'Admin' })}.${cashierToken.split('.')[2]}`;
    const noneAlg = `${b64({ alg: 'none', typ: 'JWT' })}.${p}.`;
    const wrongSecret = require('jsonwebtoken').sign(payload, 'not-the-real-secret');
    const expired = require('jsonwebtoken').sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 3600 }, 'not-the-real-secret');
    for (const [label, bad] of [
      ['payload edited (different user id), signature kept', forgedAdmin],
      ['cashier token edited to role Admin', elevated],
      ['alg "none" token', noneAlg],
      ['token signed with a different secret', wrongSecret],
      ['expired token', expired],
      ['garbage token', 'not.a.jwt'],
    ]) {
      const r = await call('GET', '/users', { token: bad });
      check(`3. ${label} -> 401`, r.status === 401, r.status);
    }
    const elevatedPrivate = await call('GET', '/users', { token: elevated });
    check('3. role-edited cashier token cannot read the user list', elevatedPrivate.status === 401 && !/password/i.test(elevatedPrivate.text), elevatedPrivate.status);

    // ---- 4. Authorization: a cashier must not reach admin features -----------------------
    const adminOnly = [
      ['GET', '/users'], ['GET', '/security-alerts'], ['GET', '/system/backup/auto-status'],
      ['GET', '/system/backup/sql'],
    ];
    for (const [method, path] of adminOnly) {
      const r = await call(method, path, { token: cashierToken });
      check(`4. cashier gets 403 on ${method} ${path}`, r.status === 403, r.status);
    }
    const createUser = await call('POST', '/users', {
      token: cashierToken,
      body: { username: 'sectest_hacker_' + RUN, password: 'Hacker-Pass-1x', role: 'Admin', display_name: 'Hacker' },
    });
    check('4. cashier cannot create an Admin account (403)', createUser.status === 403, createUser.status);
    const [made] = await conn.query('SELECT id FROM users WHERE username = ?', ['sectest_hacker_' + RUN]);
    check('4. no hacker account exists in the database', made.length === 0, made);

    const victim = (await conn.query('SELECT id FROM users WHERE username = ?', [VICTIM_USER]))[0][0];
    const cashierDelete = await call('DELETE', `/users/${victim.id}`, { token: cashierToken });
    check('4. cashier cannot delete another user (403)', cashierDelete.status === 403, cashierDelete.status);
    const cashierReset = await call('PUT', `/users/${victim.id}`, { token: cashierToken, body: { password: 'Taken-Over-1x', role: 'Admin' } });
    check('4. cashier cannot change another user\'s password/role (403)', cashierReset.status === 403, cashierReset.status);
    const stillVictim = await login(VICTIM_USER, VICTIM_PASS);
    check('4. victim account is unchanged after the attempts', stillVictim.status === 200, stillVictim.status);

    // ---- 5. Injection ----------------------------------------------------------------------
    const sqli = ["' OR '1'='1", "admin'--", "' UNION SELECT 1,2,3--", "'; DROP TABLE users;--", '" OR ""="'];
    for (const payloadText of sqli) {
      const r = await login(payloadText, payloadText);
      check(`5. SQL injection in login (${payloadText}) is rejected, no token, no 500`, r.status >= 400 && r.status < 500 && !r.body?.token, r.status);
    }
    const [usersAfter] = await conn.query('SELECT COUNT(*) AS n FROM users');
    check('5. users table still exists after DROP TABLE payload', Number(usersAfter[0].n) > 0, usersAfter);
    for (const [path, label] of [
      ['/orders/history?search=' + encodeURIComponent("' OR 1=1--"), 'orders history search'],
      ['/menu?category=' + encodeURIComponent("' OR 1=1--"), 'menu category filter'],
      ['/expenses?from=' + encodeURIComponent("2026-01-01' OR '1'='1"), 'expenses date filter'],
      ['/reservations?date=' + encodeURIComponent("2026-01-01' OR '1'='1"), 'reservations date filter'],
    ]) {
      const r = await call('GET', path, { token });
      check(`5. SQL injection in ${label} does not cause a 500`, r.status < 500, r.status);
    }

    // ---- 6. Stored XSS: markup must stay inert text in JSON, never executable HTML ---------
    const xss = `<img src=x onerror=alert(1)>${RUN}`;
    const created = await call('POST', '/menu', { token, body: { name: xss, category: 'Coffee', price: 1.5 } });
    const newId = created.body?.item?.id;
    if (newId) itemIds.push(newId);
    check('6. menu item with markup in its name is stored or rejected, never a 500', created.status < 500, created.status);
    const listing = await call('GET', '/menu', { token });
    check('6. API returns JSON (not HTML) so markup cannot execute', /application\/json/.test(listing.headers.get('content-type') || ''), listing.headers.get('content-type'));
    check('6. API sets X-Content-Type-Options: nosniff', listing.headers.get('x-content-type-options') === 'nosniff', listing.headers.get('x-content-type-options'));

    // ---- 8. HTTP hardening -----------------------------------------------------------------
    const health = await call('GET', '/health');
    check('8. helmet: X-Content-Type-Options is nosniff', health.headers.get('x-content-type-options') === 'nosniff');
    check('8. helmet: X-Frame-Options or frame-ancestors is set (clickjacking)', !!health.headers.get('x-frame-options') || /frame-ancestors/.test(health.headers.get('content-security-policy') || ''));
    check('8. X-Powered-By is hidden', !health.headers.get('x-powered-by'), health.headers.get('x-powered-by'));
    const evilCors = await call('GET', '/health', { headers: { Origin: 'https://evil.example' } });
    check('8. CORS does not allow an unknown origin', evilCors.headers.get('access-control-allow-origin') !== 'https://evil.example' && evilCors.headers.get('access-control-allow-origin') !== '*', evilCors.headers.get('access-control-allow-origin'));
    const goodCors = await call('GET', '/health', { headers: { Origin: 'http://localhost:5173' } });
    check('8. CORS allows the real frontend origin', goodCors.headers.get('access-control-allow-origin') === 'http://localhost:5173', goodCors.headers.get('access-control-allow-origin'));

    // ---- 9. Error handling and information leakage -----------------------------------------
    const badJson = await call('POST', '/auth/login', { body: '{"username": ' });
    check('9. malformed JSON gives a 4xx, not a 500', badJson.status >= 400 && badJson.status < 500, badJson.status);
    check('9. malformed JSON response does not leak a stack trace or file paths', !/at .*\(.*\.js:\d+|node_modules|[A-Z]:\\\\/.test(badJson.text), badJson.text.slice(0, 200));
    const huge = await call('POST', '/auth/login', { body: { username: 'a'.repeat(2_000_000), password: 'x' } });
    check('9. oversized body is refused (413) rather than processed', huge.status === 413 || huge.status === 400, huge.status);
    const unknown = await call('GET', '/definitely-not-a-route', { token });
    check('9. unknown route returns 404 without a stack trace', unknown.status === 404 && !/\.js:\d+/.test(unknown.text), unknown.status);

    // ---- 10. Static files and path traversal ----------------------------------------------
    for (const path of ['/uploads/../.env', '/uploads/..%2f.env', '/uploads/%2e%2e/%2e%2e/.env', '/api/uploads/..%2f..%2fserver.js']) {
      const r = await call('GET', path, { raw: true });
      check(`10. path traversal ${path} does not expose files`, !/JWT_SECRET|DB_PASSWORD|require\(/.test(r.text), r.status);
    }
    const receipt = await call('GET', '/expenses/1/receipt');
    check('10. private expense receipts need a token (401)', receipt.status === 401, receipt.status);
    const privateDir = await call('GET', '/private-uploads/anything.jpg', { raw: true });
    check('10. private-uploads is not served statically', privateDir.status === 404 || privateDir.status === 401, privateDir.status);

    // ---- 11. Session revocation after logout ----------------------------------------------
    // Reuse the cashier token from section 2: the login rate limiter would answer 429 to another login from this IP.
    const freshToken = cashierToken;
    const before = await call('GET', '/menu', { token: freshToken });
    const out = await call('POST', '/auth/logout', { token: freshToken });
    const after = await call('GET', '/menu', { token: freshToken });
    check('11. token works before logout', before.status === 200, { status: before.status, body: before.body });
    check('11. logout succeeds', out.status < 300, out.status);
    check('11. the same token is refused after logout (401)', after.status === 401, after.status);
    // ---- 12. Brute force (run last: it locks the account/IP) --------------------------------------------------------------------
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await login(VICTIM_USER, 'wrong-' + i)).status);
    }
    check('12. repeated wrong passwords trigger a lock or rate limit (403/423/429)', statuses.some((s) => [403, 423, 429].includes(s)), statuses);
    const afterLock = await login(VICTIM_USER, VICTIM_PASS);
    check('12. the correct password is also refused while the account is locked', [403, 423, 429].includes(afterLock.status), afterLock.status);

  } finally {
    await cleanup(conn, itemIds);
    await conn.end();
  }
}

run()
  .catch((error) => {
    failures += 1;
    console.log(`FAIL  unexpected error: ${error.stack || error}`);
  })
  .finally(() => {
    console.log(`\n${total - failures}/${total} checks passed`);
    process.exit(failures ? 1 : 0);
  });
