const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const DB_NAME = process.env.TEST_DB_NAME || '';
if (!DB_NAME || !DB_NAME.toLowerCase().includes('test')) {
  console.error('Refusing to run: set TEST_DB_NAME to a throwaway database whose name contains "test".');
  process.exit(2);
}

const PORT = process.env.TEST_PORT || 5632;
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN_USER = 'restest_admin';
const ADMIN_PASS = 'Res-Test-Only-9!';
const RUN = `E2E Res ${Date.now().toString(36)}`;

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

function nextTuesday() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7));
  while (date.getUTCDay() !== 2) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function run() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '', database: DB_NAME });
  try {
    await conn.execute('DELETE FROM users WHERE username = ?', [ADMIN_USER]);
    await conn.execute(
      `INSERT INTO users (display_name, username, password_hash, role, permissions, is_active, must_change_password)
       VALUES (?, ?, ?, 'Admin', '[]', 1, 0)`,
      ['Reservation Test Admin', ADMIN_USER, await bcrypt.hash(ADMIN_PASS, 10)],
    );
    const login = await call('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
    const token = login.body?.token;
    check('admin login returns a token', !!token, login);
    if (!token) return;

    const [tables] = await conn.execute('SELECT id FROM tables WHERE capacity >= 4 ORDER BY id LIMIT 1');
    const tableId = tables[0].id;
    const date = nextTuesday();
    const booking = (extra = {}) => ({
      customer_name: RUN,
      phone: '012 345 678',
      reservation_date: date,
      time_slot: '19:00',
      table_id: tableId,
      guest_count: 2,
      status: 'Confirmed',
      ...extra,
    });

    const parallel = await Promise.all(
      Array.from({ length: 6 }, () => call('POST', '/reservations', { token, body: booking() })),
    );
    const created = parallel.filter((r) => r.status === 201);
    check('6 parallel POSTs for one table/slot -> exactly one 201', created.length === 1, parallel.map((r) => r.status));
    check('the losers get 409 with the real reason', parallel.filter((r) => r.status === 409).every((r) => /booked|another device/i.test(r.body?.message || '')), parallel.map((r) => r.body?.message));
    const first = created[0]?.body;
    check('client-supplied duration is ignored', first?.duration_minutes === 120, first);

    const overlap = await call('POST', '/reservations', { token, body: booking({ time_slot: '20:00', duration_minutes: 600 }) });
    check('19:00-21:00 vs 20:00-21:00 overlap -> 409', overlap.status === 409, overlap);

    const before = await call('POST', '/reservations', { token, body: booking({ time_slot: '17:00', duration_minutes: 600 }) });
    check('17:00-19:00 next to 19:00 is allowed and keeps a 120 minute duration', before.status === 201 && before.body?.duration_minutes === 120, before);

    const seatedMove = await call('PUT', `/reservations/${before.body?.id}`, { token, body: { time_slot: '19:00', status: 'Seated' } });
    check('moving a booking onto a taken slot as Seated -> 409', seatedMove.status === 409, seatedMove);

    await conn.execute('UPDATE reservations SET reminder_1d_sent = 1, reminder_3d_sent = 1 WHERE id = ?', [before.body?.id]);
    const moved = await call('PUT', `/reservations/${before.body?.id}`, { token, body: { time_slot: '15:00' } });
    const [flags] = await conn.execute('SELECT reminder_1d_sent, reminder_3d_sent FROM reservations WHERE id = ?', [before.body?.id]);
    check('rescheduling resets the reminder flags', moved.status === 200 && flags[0].reminder_1d_sent === 0 && flags[0].reminder_3d_sent === 0, { moved, flags });

    const badDate = await call('POST', '/reservations', { token, body: booking({ reservation_date: '2026-02-31' }) });
    check('impossible date -> 400 with a real message', badDate.status === 400 && /calendar date/.test(badDate.body?.message || ''), badDate);
    const past = await call('POST', '/reservations', { token, body: booking({ reservation_date: '2020-01-07' }) });
    check('past date -> 400', past.status === 400 && /past/.test(past.body?.message || ''), past);
    const tooMany = await call('POST', '/reservations', { token, body: booking({ time_slot: '09:00', guest_count: 99 }) });
    check('guest count above table capacity -> 400', tooMany.status === 400 && /seats at most/.test(tooMany.body?.message || ''), tooMany);
    const listBad = await call('GET', '/reservations?date=not-a-date', { token });
    check('GET /reservations with an invalid date -> 400', listBad.status === 400, listBad.status);

    const canceled = await call('PUT', `/reservations/${first?.id}`, { token, body: { status: 'Canceled' } });
    check('cancel frees the slot', canceled.status === 200 && (await call('POST', '/reservations', { token, body: booking({ time_slot: '20:00' }) })).status === 201);

    const [audit] = await conn.execute(
      "SELECT action FROM audit_logs WHERE action LIKE 'reservation_%' AND description LIKE ?",
      [`%${RUN}%`],
    );
    const actions = new Set(audit.map((row) => row.action));
    check('audit log has create and update entries', actions.has('reservation_create') && actions.has('reservation_update'), [...actions]);
  } finally {
    await conn.execute('DELETE FROM reservations WHERE customer_name = ?', [RUN]).catch(() => null);
    await conn.execute('DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)', [ADMIN_USER]).catch(() => null);
    await conn.execute('DELETE FROM users WHERE username = ?', [ADMIN_USER]).catch(() => null);
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
