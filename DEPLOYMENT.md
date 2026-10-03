# Deployment notes

Keep MySQL on the machine that runs the API. Do not open port 3306 to the internet. The public site should expose only 80 and 443 through a reverse proxy. The API talks to MySQL on `127.0.0.1`.

## Go-live checklist

Do these in order. The API refuses to boot in production if `JWT_SECRET` is weak or `FRONTEND_URL` is still localhost/http.

1. **MySQL** — import/create `mlu_kitchen_cafe_db`, create a dedicated app user (below), leave port 3306 closed to the internet.
2. **Backend env** — copy `backend/.env.example` → `backend/.env` and set at least:
   - `NODE_ENV=production`
   - `DB_*` for the dedicated user
   - `JWT_SECRET` ≥ 32 random characters
   - `FRONTEND_URL=https://your-cafe-site.example`
   - `CORS_ALLOWED_ORIGINS=` (optional extras; defaults to `FRONTEND_URL`)
   - `TRUST_PROXY=true` when nginx/Cloudflare terminates TLS
   - `ADMIN_EMAIL=` real inbox
   - `SMTP_*` if you need reservation confirmation emails
3. **Frontend env** — copy `frontend/.env.production.example` → `frontend/.env.production`:
   - `VITE_API_URL=https://api.your-cafe-site.example/api`
4. **Install** — `npm run install:all` on the server.
5. **Build** — `npm run build` (bakes `VITE_API_URL` into `frontend/dist/`).
6. **Preflight** — `npm run check:prod` (must exit 0; warnings are OK if you accept them).
7. **Admin account** — ensure one Admin exists (`npm run admin:reset` if needed). Never run `seed:admin` on a live DB with staff accounts unless you intend to wipe users.
8. **Process manager** — run `npm --prefix backend start` under PM2/systemd (or Laragon’s Node process). Serve `frontend/dist/` with nginx/Apache/Caddy.
9. **Smoke test**
   - `GET https://api…/api/health` → `{ "ok": true, "database": "up" }`
   - Open the site, sign in, place a test order, check Stock + Sales History
10. **Backups** — schedule SQL dumps; logs live in `backend/logs/` (gitignored).

## Dedicated database user

Do not run the app as MySQL `root`. Create a user that can use only `mlu_kitchen_cafe_db`.

The server creates and alters tables when it starts (login security, reservations, session revocation, and similar). Until that startup work is moved to a separate migration step, the app user needs those rights:

```sql
CREATE USER 'mlu_app'@'127.0.0.1' IDENTIFIED BY 'choose_a_long_password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON mlu_kitchen_cafe_db.* TO 'mlu_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Put that user in `backend/.env`:

```
DB_HOST=127.0.0.1
DB_USER=mlu_app
DB_PASSWORD=choose_a_long_password
DB_NAME=mlu_kitchen_cafe_db
```

If MySQL is bound to `127.0.0.1` only (`bind-address = 127.0.0.1`), a host firewall should still drop inbound 3306. Do not add a cloud security-group rule for 3306.

## HTTPS

Set `NODE_ENV=production` on the API. It then redirects plain HTTP to HTTPS with status 308, which keeps the original method and body. `GET /api/health` is excluded so load-balancer probes over HTTP still work. `req.secure` follows Express `trust proxy`: the `X-Forwarded-Proto` header is trusted only when `TRUST_PROXY=true`. Turn that on when nginx or Cloudflare terminates TLS in front of Node. Leave it off when Node itself is the TLS endpoint. In production the API also sends `Strict-Transport-Security` (one year, including subdomains).

Behind nginx, set:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Example API location block:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:5500/api/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Example static frontend (SPA hash routing still works as a single `index.html`):

```nginx
root /var/www/mlu-cafe/frontend/dist;
location / {
  try_files $uri $uri/ /index.html;
}
```

## React app headers

The static site is separate from the API. Put these headers on the server that serves the built React app. Replace `https://api.example.com` with the real API origin. Fonts ship from the Vite build (`@fontsource`); no Google Fonts CDN is required.

```nginx
add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https://api.example.com" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

If the API and site share one origin (e.g. `https://cafe.example.com` + `/api`), `connect-src 'self'` is enough and you can drop the separate API host.

## Notifications (stock, expenses, reservations)

The bell polls `/api/alerts` while someone is signed in. It refreshes when the tab is focused, when the browser comes back online, and about every 20 seconds while the tab is visible. Stock changes clear the server alert cache immediately so online admins see low/out-of-stock notices quickly. Expense till notices are stored for **Admin** accounts only.

For the frontend to reach the API from your public domain, set:

```
FRONTEND_URL=https://your-cafe-site.example
CORS_ALLOWED_ORIGINS=https://your-cafe-site.example
TRUST_PROXY=true
```

And build the React app with `VITE_API_URL=https://api.your-cafe-site.example/api` (same origin path the CSP `connect-src` allows).

## Health check

```bash
curl -sS https://api.your-cafe-site.example/api/health
```

Expected:

```json
{ "ok": true, "service": "mlu-kitchen-cafe-api", "database": "up", "uptimeSec": 12, "latencyMs": 3 }
```

`database: "down"` returns HTTP 503.

## Same-machine Laragon (temporary public access)

If you expose this Windows/Laragon PC:

- Put nginx/Caddy (or Laragon SSL) in front for HTTPS.
- Keep MySQL bound to `127.0.0.1`.
- Set `TRUST_PROXY=true` if the proxy terminates TLS.
- Do not port-forward 3306 or 5500 raw to the internet; proxy only 443 → Node/static.
