// Runs every test: unit tests first, then each e2e suite against a throwaway
// database on its own port. Usage: npm run test:all
require('dotenv').config({ quiet: true });
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const TEST_DB = process.env.TEST_DB_NAME || 'mlu_cafe_e2e_test';
if (!TEST_DB.toLowerCase().includes('test')) {
  console.error('TEST_DB_NAME must contain "test".');
  process.exit(2);
}
const SOURCE_DB = process.env.DB_NAME;

// [npm script, file, port]; security runs last because it triggers lockouts.
const E2E = [
  ['test:menu-api', 'menuApi.e2e.cjs', 5611],
  ['test:users-api', 'usersApi.e2e.cjs', 5611],
  ['test:menu-stock-api', 'menuStockApi.e2e.cjs', 5613],
  ['test:ingredients-api', 'ingredientsApi.e2e.cjs', 5614],
  ['test:orders-audit-api', 'ordersAudit.e2e.cjs', 5631],
  ['test:reservations-api', 'reservationsApi.e2e.cjs', 5632],
  ['test:restore-api', 'restoreApi.e2e.cjs', 5633],
  ['test:reports-api', 'reportsApi.e2e.cjs', 5634],
  ['test:security-api', 'securityApi.e2e.cjs', 5611],
];

const CATALOG_TABLES = ['menu_items', 'inventory', 'menu_item_stock_links', 'tables', 'expense_categories'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (database) =>
  mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DB_PASSWORD || '',
    database,
  });

// Fixture the menu-stock suite expects: an ingredient linked to two menu items.
async function addMilkFixture(c) {
  const [items] = await c.query(`SELECT id FROM \`${TEST_DB}\`.menu_items ORDER BY id LIMIT 2`);
  const [ins] = await c.query(
    `INSERT INTO \`${TEST_DB}\`.inventory (item_name, category, section, stock_quantity, max_stock, unit_label, unit_singular, low_threshold, is_ingredient)
     VALUES ('Test Milk', 'Dairy', 'countable', 3, 24, 'boxes', 'box', 5, 1)`,
  );
  for (const it of items) {
    await c.query(
      `INSERT INTO \`${TEST_DB}\`.menu_item_stock_links (menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit)
       VALUES (?, '', '', '', ?, 0.2)`,
      [it.id, ins.insertId],
    );
  }
}

async function prepareDatabase() {
  const c = await connect(undefined);
  await c.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\``);
  const [tables] = await c.query(
    "SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [SOURCE_DB],
  );
  await c.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of tables) {
    await c.query(`CREATE TABLE IF NOT EXISTS \`${TEST_DB}\`.\`${t.n}\` LIKE \`${SOURCE_DB}\`.\`${t.n}\``);
  }
  // Catalog data some suites expect to exist (menu, ingredients, floor tables).
  for (const t of CATALOG_TABLES) {
    {
      await c.query(`DELETE FROM \`${TEST_DB}\`.\`${t}\``);
      // Columns shared by both copies, since startup migrations may reorder them.
      const [cols] = await c.query(
        `SELECT a.COLUMN_NAME n FROM information_schema.COLUMNS a
         JOIN information_schema.COLUMNS b ON b.COLUMN_NAME = a.COLUMN_NAME AND b.TABLE_NAME = a.TABLE_NAME AND b.TABLE_SCHEMA = ?
         WHERE a.TABLE_SCHEMA = ? AND a.TABLE_NAME = ?`,
        [SOURCE_DB, TEST_DB, t],
      );
      const list = cols.map((x) => `\`${x.n}\``).join(',');
      await c.query(`INSERT INTO \`${TEST_DB}\`.\`${t}\` (${list}) SELECT ${list} FROM \`${SOURCE_DB}\`.\`${t}\``);
    }
  }
  await addMilkFixture(c);
  await c.end();
}

async function clearLockouts() {
  const c = await connect(TEST_DB);
  try {
    await c.query('DELETE FROM login_attempts');
  } catch {
    // table may not exist yet on a fresh database
  }
  await c.end();
}

function startServer(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_NAME: TEST_DB },
    stdio: 'ignore',
  });
  return child;
}

async function waitHealthy(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  return false;
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    } else {
      child.kill('SIGKILL');
    }
    setTimeout(resolve, 3000);
  });
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    p.on('exit', (code) => resolve(code));
  });
}

async function main() {
  const results = [];

  console.log('\n######## UNIT TESTS (npm test) ########\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const unit = spawnSync(npm, ['test'], { cwd: ROOT, stdio: 'inherit', shell: true });
  results.push(['unit tests (npm test)', unit.status === 0]);

  await prepareDatabase();

  for (const [name, file, port] of E2E) {
    console.log(`\n######## ${name} (port ${port}) ########\n`);
    await clearLockouts();
    const server = startServer(port);
    const up = await waitHealthy(port);
    if (!up) {
      console.log(`Server did not start on port ${port}`);
      results.push([name, false]);
      await stopServer(server);
      continue;
    }
    const code = await runNode([path.join('test', file)], {
      TEST_DB_NAME: TEST_DB,
      TEST_PORT: String(port),
    });
    results.push([name, code === 0]);
    await stopServer(server);
  }

  console.log('\n======== SUMMARY ========');
  for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`${results.length - failed}/${results.length} suites passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
