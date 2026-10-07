const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5633;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'restoretest_admin';
const ADMIN_PASS = 'Restore-Test-Only-9!';

const DROPPED_COLUMNS = [
  ['inventory', 'archived_at'],
  ['inventory', 'is_ingredient'],
  ['inventory', 'pack_size'],
  ['menu_items', 'unavailable_since'],
  ['order_items', 'item_category'],
  ['reservations', 'duration_minutes'],
];
const DROPPED_TABLES = ['app_settings', 'admin_notifications'];

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

async function call(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${urlPath}`, {
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

async function existingColumns(conn) {
  const [cols] = await conn.query(
    'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?',
    [DB_NAME],
  );
  return new Set(cols.map((c) => `${c.TABLE_NAME}.${c.COLUMN_NAME}`));
}

async function existingTables(conn) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [DB_NAME],
  );
  return new Set(rows.map((r) => r.TABLE_NAME));
}

async function waitForSchema(conn) {
  for (let i = 0; i < 60; i += 1) {
    const have = await existingColumns(conn);
    const tables = await existingTables(conn);
    if (
      DROPPED_COLUMNS.every(([t, c]) => have.has(`${t}.${c}`))
      && DROPPED_TABLES.every((t) => tables.has(t))
      && have.has('users.tokens_valid_after')
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function seedAdmin(conn) {
  await conn.execute('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  await conn.execute(
    `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
     VALUES (?, ?, ?, 'Admin', '[]', 1, 0)`,
    ['Restore Test Admin', ADMIN_USER, hash],
  );
}

async function login() {
  const r = await call('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
  return r.body?.token || null;
}

async function saleDateFingerprint(conn) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n, COALESCE(SUM(UNIX_TIMESTAMP(updated_at)), 0) AS s FROM orders",
  );
  return `${row.n}:${row.s}`;
}

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: DB_NAME,
  });
  const dumpPath = path.join(os.tmpdir(), `mlu-restore-e2e-${Date.now()}.sql`);

  try {
    const ready = await waitForSchema(conn);
    check('server startup created the current schema', ready);
    if (!ready) return;

    const [[flag]] = await conn.query(
      "SELECT COUNT(*) AS n FROM app_settings WHERE setting_key = 'orders_sale_date_repair_done'",
    );
    check('sale date repair is recorded as done once in app_settings', Number(flag.n) === 1, flag);

    await seedAdmin(conn);
    const token = await login();
    check('admin login returns a token', !!token);
    if (!token) return;

    const [late] = await conn.query('SELECT id FROM orders ORDER BY id LIMIT 1');
    if (late.length) {
      await conn.query(
        'UPDATE orders SET updated_at = DATE_ADD(created_at, INTERVAL 3 DAY) WHERE id = ?',
        [late[0].id],
      );
    }
    const beforeDates = await saleDateFingerprint(conn);

    for (const [table, column] of DROPPED_COLUMNS) {
      await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
    }
    for (const table of DROPPED_TABLES) {
      await conn.query(`DROP TABLE \`${table}\``);
    }

    const dump = await fetch(`${BASE}/system/backup/sql`, { headers: { Authorization: `Bearer ${token}` } });
    check('old-style SQL backup downloads', dump.status === 200, dump.status);
    if (dump.status !== 200) return;
    fs.writeFileSync(dumpPath, Buffer.from(await dump.arrayBuffer()));
    const dumpText = fs.readFileSync(dumpPath, 'utf8');
    check('the backup really lacks the newer columns', !dumpText.includes('`unavailable_since`') && !dumpText.includes('`archived_at`'));

    const form = new FormData();
    form.append('sqlFile', new Blob([fs.readFileSync(dumpPath)], { type: 'application/sql' }), 'old-backup.sql');
    const restoreRes = await fetch(`${BASE}/system/backup/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const restoreBody = await restoreRes.json().catch(() => null);
    check('restore of an older backup returns 200', restoreRes.status === 200, restoreBody);
    check('restore message asks the Admin to check the Users page', /Users page/.test(restoreBody?.message || ''), restoreBody);

    const have = await existingColumns(conn);
    const tables = await existingTables(conn);
    check(
      'restore re-ran the schema steps without a restart',
      DROPPED_COLUMNS.every(([t, c]) => have.has(`${t}.${c}`)) && DROPPED_TABLES.every((t) => tables.has(t)),
    );

    const oldTokenUse = await call('GET', '/inventory', { token });
    check('sessions from before the restore are signed out', oldTokenUse.status === 401, oldTokenUse.status);

    await new Promise((r) => setTimeout(r, 1100));
    const freshToken = await login();
    check('admin can sign in again after the restore', !!freshToken);
    if (!freshToken) return;

    for (const route of ['/inventory', '/inventory/menu-stock', '/menu', '/reservations', '/alerts', '/settings/exchange-rate']) {
      const r = await call('GET', route, { token: freshToken });
      check(`GET ${route} works right after the restore`, r.status === 200, { status: r.status, body: r.body });
    }

    const afterDates = await saleDateFingerprint(conn);
    check('restore and schema refresh did not rewrite sale dates (updated_at)', beforeDates === afterDates, { beforeDates, afterDates });
  } finally {
    fs.promises.rm(dumpPath, { force: true }).catch(() => {});
    await conn.query('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [ADMIN_USER]).catch(() => {});
    await conn.query('DELETE FROM users WHERE username = ?', [ADMIN_USER]).catch(() => {});
    await conn.end();
  }
}

run()
  .catch((error) => {
    failures += 1;
    console.log(`FAIL  unexpected error: ${error.stack || error.message}`);
  })
  .finally(() => {
    console.log(`\n${total - failures}/${total} checks passed`);
    process.exit(failures ? 1 : 0);
  });
