# Mlu Kitchen & Cafe Siem Reap — Management System

A point-of-sale and back-office system for Mlu Kitchen & Cafe Siem Reap (Siem Reap, Cambodia).
It covers the full floor-to-books workflow: taking orders, managing tables, taking payment,
tracking stock, managing the menu, and reporting on sales — with role-based access control,
an audit trail.

The system is a two-part application:

- **Frontend** — React 19 + Vite, styled with Tailwind CSS, bilingual (English / Khmer) via i18next.
- **Backend** — Express 5 REST API backed by MySQL, with JWT authentication.

## Features by screen

The sidebar tabs map one-to-one onto the files in `frontend/src/pages/`:

| Sidebar tab                | Page component            | What it does                                               |
| -------------------------- | ------------------------- | ---------------------------------------------------------- |
| Dashboard                  | `Dashboard.jsx`           | Live KPIs, alerts, and daily sales overview                 |
| Users                      | `Users.jsx`               | Cashier/Staff accounts, roles, and per-view permissions (admin) |
| Order                      | `Order.jsx`               | POS order entry for dine-in and takeaway                    |
| Table                      | `Table.jsx`               | Floor plan and per-table bill status                        |
| Payment                    | `Payment.jsx`             | Checkout, split/settle bills, and receipt printing          |
| Sales History              | `SalesHistory.jsx`        | Completed transactions, receipt reprints, expense tracking  |
| Inventory & Stock          | `InventoryStock.jsx`      | Ingredient stock levels and low-stock alerts                |
| Menu Management            | `MenuManagement.jsx`      | Menu items, pricing, and photos                             |
| Reports → Analysis         | `ReportsAnalysis.jsx`     | Sales charts and breakdowns over a chosen period            |
| Others → Settings          | `Settings.jsx`            | Theme for everyone; store hours / low-stock alerts need Settings tick |
| Others → Data Management   | `BackupRecovery.jsx`      | Excel/PDF/SQL downloads (permission); Restore is Admin-only |

## Roles and permissions

| Role | Assignable | Defaults | Notes |
|------|------------|----------|--------|
| **Admin** | No (exactly one) | All ticks (bypass) | Sole access to Users, Security Alerts (login alerts + Audit log + Active sessions), and Restore |
| **Cashier** | Yes | Order, Table, Payment, Reservations, Sales | Any allowlisted tick may be granted |
| **Staff** | Yes | Order, Table, Reservations | Any allowlisted tick may be granted |

**Permission ticks** (stored keys → pages/actions):

| Key | UI label | Opens |
|-----|----------|--------|
| `dashboard` | Dashboard | Dashboard page |
| `order` | Order | Order page / POS write |
| `table` | Table | Table / floor |
| `reservations` | Reservations | Reservations (also allowed via `table`) |
| `payment` | Payment | Payment page |
| `menu` | Menu Management | Menu CRUD |
| `settings` | Settings | Non-theme Settings sections (theme is always available) |
| `backup_recovery` | Data Management | Excel / PDF / SQL **download** |
| `sales_history` | Sales | Sales History |
| `inventory_stock` | Stock | Full Stock page (add/adjust/stocktake/edit/link) |
| `reports` | Reports | Reports page, expenses, Dashboard spending/profit |

**Hard Admin-only** (ticks ignored): Users APIs/page; Security Alerts + Audit log + Active sessions; database Restore.

There are no role ceilings. Unknown permission keys on save return **400**. Role `Admin` or `Supervisor` cannot be assigned on create. Logout happens only on **401**, never on **403**.

The login screen is `Login.jsx`. Routing is state-based (`App.jsx` switches on a view id and
mirrors it to the URL hash) rather than react-router, so the view ids in
`frontend/src/utils/activeViewStorage.js` are the source of truth for navigation.

## Folder structure

```
mlu-cafe-system/
├── package.json              # Convenience scripts that delegate to backend/ and frontend/
├── README.md
├── menu-photos/              # Drop camera photos here. Filename = dish (espresso.jpg)
│
├── backend/                  # Express + MySQL API
│   ├── server.js             # Entry point — starts the API and mounts all routes
│   ├── db.js                 # MySQL connection pool
│   ├── .env.example          # Copy to .env and fill in
│   ├── scripts/              # One-off seeding scripts (admin user, sample sales, menu photos)
│   ├── seeds/                # Numbered SQL migrations, applied on startup
│   └── src/
│       ├── config/           # env.js (validated env vars), store.js (business constants)
│       ├── constants/        # Permission ids shared with the frontend
│       ├── middleware/       # JWT auth / route guards
│       ├── scripts/          # Sales seeders
│       └── utils/            # Domain logic: alerts, backups, audit log
│
└── frontend/                 # React + Vite single-page app
    ├── index.html
    ├── vite.config.js
    ├── .env.example          # Copy to .env and fill in
    ├── public/
    │   ├── favicon.svg
    │   ├── logo/
    │   │   ├── logo.png            # Login screen
    │   │   └── sidebar-logo.png    # Sidebar
    │   └── menu-images/            # Photos the app serves (same names as menu-photos/)
    │       └── thumbs/             # Small WebP previews used on Order / Menu
    └── src/
        ├── main.jsx          # React entry point + global providers
        ├── App.jsx           # View routing and access control
        ├── i18n.js           # English / Khmer translations
        ├── index.css         # Tailwind layers and design tokens
        ├── pages/            # One file per sidebar tab (see table above)
        ├── components/
        │   ├── common/       # App shell: DashboardLayout, Sidebar, NotificationBell
        │   ├── ui/           # Reusable widgets: modals, toggles, filter bars
        │   ├── alerts/       # Alert centre
        │   ├── finance/      # Expense tracker
        │   ├── menu/         # Menu item image
        │   ├── pos/          # Payment module + receipt modal
        │   └── security/     # Audit log panel
        ├── context/          # Global state: Auth, POS/cart, Alerts, Notifications, Settings, Theme
        ├── services/         # API layer: apiClient.js (fetch wrapper), sessionStorage.js
        ├── hooks/            # Shared React hooks
        ├── utils/            # Pure helpers: formatting, analytics, permissions, offline fallbacks
        ├── data/             # Static seed/fallback data used when the API is unreachable
        └── config/           # store.js — business constants (name, tax, currency)
```

## Getting started

### Prerequisites

- **Node.js 18+** and npm
- **MySQL 8** (Laragon, XAMPP, or a standalone server)

### 1. Start the database

Start MySQL (in Laragon, click **Start All**), then create an empty database:

```sql
CREATE DATABASE mlu_kitchen_cafe_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

You do not need to import any tables by hand — the backend applies the SQL files in
`backend/seeds/` automatically on startup.

### 2. Configure environment variables

Copy the example files and edit them. Never commit the real `.env` files; both are gitignored.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`backend/.env` — the backend refuses to start if any of `DB_HOST`, `DB_USER`, `DB_NAME`,
or `JWT_SECRET` is missing:

| Variable       | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `PORT`         | API port (default `5500`)                                      |
| `DB_HOST`      | MySQL host, e.g. `127.0.0.1`                                   |
| `DB_USER`      | MySQL user, e.g. `root`                                        |
| `DB_PASSWORD`  | MySQL password (blank on a default Laragon install)            |
| `DB_NAME`      | Database name, e.g. `mlu_kitchen_cafe_db`                      |
| `JWT_SECRET`   | Long random string used to sign login tokens — **change this** |
| `FRONTEND_URL` | Allowed CORS origin, e.g. `http://localhost:5173`              |

`frontend/.env` needs only the API base URL. It is baked into the build at compile time, so
rebuild after changing it:

```
VITE_API_URL=http://localhost:5500/api
```

The remaining variables in `backend/.env.example` are optional and documented inline
(SMTP, rate limits, MySQL bin path, alert cache TTL).

### 3. Install dependencies

```bash
npm run install:all
```

Or install each app separately:

```bash
cd backend  && npm install
cd frontend && npm install
```

### 4. Create the first admin user

```bash
cd backend
npm run seed:admin
```

`seed:admin` **deletes every user** and creates a single Admin. Use it only on a fresh
database. To recover a forgotten Admin password later without wiping Staff accounts, use
`npm run admin:reset` (see **Emergency Admin recovery** below).

Optionally load sample transactions so the dashboard and reports have data to show:

```bash
npm run seed:sales        # June 2025 → today, current menu names
npm run seed:expenses     # operating costs that follow those sale dates
```

### 5. Run the app

Run these in two terminals:

```bash
# Terminal 1 — backend API on http://localhost:5500
cd backend
npm start          # or: npm run dev   (nodemon, auto-restarts on change)
```

```bash
# Terminal 2 — frontend on http://localhost:5173
cd frontend
npm run dev
```

Open <http://localhost:5173> and sign in with the admin account you seeded.

## Production build

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full go-live checklist (DB user, HTTPS, nginx,
CSP, health check).

```bash
# 1) Set production URLs in backend/.env and frontend/.env.production
# 2) Build the static site (bakes VITE_API_URL into the bundle)
npm run build

# 3) Preflight — exits 1 if blockers remain
npm run check:prod
```

This emits a static bundle to `frontend/dist/`. Serve that directory with any static host
(Nginx, Apache, Netlify, Vercel), and run the backend with `npm start` behind a process
manager such as PM2 or a systemd unit. Uptime probes can hit `GET /api/health`.

Before deploying, make sure you have:

- set a strong, unique `JWT_SECRET` (at least 32 random characters — the server refuses to
  boot in production with a weak one)
- pointed `DB_*` at your production database with a least-privilege user
- set `FRONTEND_URL` to your real **https** frontend origin so CORS is correctly restricted
  (localhost is rejected when `NODE_ENV=production`)
- set `VITE_API_URL` (in `frontend/.env.production`) to your public API URL **before**
  running the build
- set `NODE_ENV=production`
- set `TRUST_PROXY=true` **only if** you run behind a reverse proxy (see below)

## Security

The backend is hardened against the common OWASP Top 10 categories. The pieces worth
knowing when you operate or extend it:

**SQL injection.** Every query uses parameterized placeholders (`?`) with bound values —
user input is never concatenated or interpolated into SQL. The few places that build SQL
fragments dynamically (`orderTargets.js`) only
ever interpolate hardcoded developer strings, never request data. Keep it that way: if you
need a dynamic column or sort order, map the input through an allowlist rather than
inlining it.

**Login and sessions.** Passwords are stored as bcrypt hashes and only ever checked with
`bcrypt.compare()`. Failed logins return one message — `"Invalid username or password"` —
for every cause, and a bcrypt comparison runs even when the account does not exist so
response timing cannot be used to discover valid usernames. Tokens are HS256 JWTs with a
`SESSION_DAYS` lifetime (default **30 days**). When a presented token’s `iat` is older than
**24 hours**, the API returns a fresh JWT in the `X-Renewed-Token` header (same `jti`); the
client stores it so active staff stay signed in without logging in again. Raising
`SESSION_DAYS` makes sessions effectively permanent for anyone who uses the till at least
monthly. There is **no idle auto-logout**. The verifier pins the algorithm, reloads the
user from the database on every request, checks `revoked_tokens` and the `user_sessions`
row, and honors `tokens_valid_after` after password changes. An administrator can
terminate any session from **Security Alerts → Active sessions**; the next request from
that device returns 401 with `Your session was ended by an administrator.` Logout still
happens only on **401**, never on 403 or network loss.

**Accounts.** There is no public sign-up. `/api/auth/register`, `/api/auth/signup`,
`/api/register`, and `/api/signup` all return 403. The system has **exactly one Admin**
account: User Management can only create Cashier or Staff, and the API rejects any
attempt to create or promote an Admin (even with an Admin token). The existing Admin’s
role cannot be changed through the API. The Admin recovery inbox is `ADMIN_EMAIL`
(default `antagonistslayer9000@gmail.com`).

**Emergency Admin recovery (server PC only).** If the Admin password is lost or the
account is locked out, someone with access to the server machine can reset it from the
backend folder — never through the web app or API:

```bash
cd backend
npm run admin:reset
```

The command prompts for a new password (hidden input; nothing is printed or passed on the
command line), enforces the normal password policy, resets the Admin hash, clears login
lockouts and related device blocks for that account, revokes existing sessions, and sets
`must_change_password`. It writes an audit log entry: `Admin password reset from server
console`. If no Admin row exists, it offers to recreate one. Prefer this over
`npm run seed:admin`, which wipes all users.

**Password reset.** `POST /api/auth/forgot-password` takes a username. If the account is
the administrator, a temporary password is emailed to `ADMIN_EMAIL` (or written to
`backend/logs/mail.log` when SMTP is not configured). If the account is staff, the
password is rotated and an unread security alert is created for every Admin user so they
can copy the temporary password from the dashboard bell and help the staff member.

**Rate limiting.** `/api/auth/login` and `/api/auth/forgot-password` allow `LOGIN_ATTEMPT_LIMIT` failed attempts (default
10) per IP per 15 minutes; successful logins are not counted, so a busy till is never
locked out by normal use. The rest of `/api` and the backup/restore endpoints have their
own broader ceilings. Limits are held in memory, which is correct for a single instance —
if you scale to several processes, move the store to Redis so the limit is shared.

**Request hygiene.** `helmet` sets the security headers, CORS is restricted to
`FRONTEND_URL` plus anything in `CORS_ALLOWED_ORIGINS`, bodies are capped at
`JSON_BODY_LIMIT`, and every `req.body`, `req.query`, and `req.params` value is stripped of
HTML tags, script blocks, event handlers, null bytes, and control characters before a route
sees it. Password fields are deliberately exempt from that rewriting so the hashed value is
exactly what the user typed. Keys that could pollute `Object.prototype` are dropped.

**Errors.** Routes never return driver output. Failures are written to
`backend/logs/error.log` with the stack, MySQL code, and `sqlMessage`, and the client gets
a generic message plus an `errorId` that matches the log entry — so a user can report an id
and you can find the exact failure without exposing anything. Authentication events go to
`backend/logs/security.log`. Both files are gitignored; rotate them with `logrotate` or the
equivalent, and ship them somewhere durable in production.

**A note on `TRUST_PROXY`.** Leave it off unless a reverse proxy really does sit in front of
the app. Enabling it without one lets any client spoof `X-Forwarded-For` and walk straight
past the login rate limiter.

## Known limitations

Completed receipts are not reversed. There is no refund flow yet, so a paid order does not put stock back. Stock counts can also drift from what is actually on the shelf. Use **Adjust stock** on the Stock page (requires the Stock permission; a reason is required) to set the exact count. **Add stock** only adds a received quantity.

## Menu item photos

Photos live in `frontend/public/menu-images/` and are served at `/menu-images/<filename>`.
Each menu item stores its photo path in the `image_url` column of the `menu_items` table, so
renaming a file in this folder will break any item already pointing at it — update the item
in **Menu Management** instead. `placeholder.jpg` is the fallback for items with no photo.
