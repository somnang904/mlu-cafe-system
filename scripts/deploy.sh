#!/usr/bin/env bash
# Pull the latest main branch, rebuild the frontend and restart the API.
#
# Run by cron on the server every few minutes; it exits straight away when
# GitHub has nothing new, so it is cheap to call often.
#
#   scripts/deploy.sh           deploy only if origin/main has new commits
#   scripts/deploy.sh --force   deploy even if already up to date
#
# The server copy should always match GitHub: local edits to tracked files on
# the server are discarded. Untracked/ignored files (.env, uploads, logs) are kept.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/mlu-cafe}"
PM2_APP="${PM2_APP:-mlu-backend}"

# cron starts with a bare PATH; pick up Node/npm/pm2 wherever they were installed.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

cd "$APP_DIR"

# Only one deploy at a time (a build takes several minutes on a small droplet).
exec 9>/tmp/mlu-deploy.lock
flock -n 9 || exit 0

git fetch --quiet origin main
local_rev="$(git rev-parse HEAD)"
remote_rev="$(git rev-parse origin/main)"

if [ "$local_rev" = "$remote_rev" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

echo "[$(date '+%F %T')] Deploying ${local_rev:0:7} -> ${remote_rev:0:7}"

git reset --hard --quiet origin/main

npm --prefix backend install --no-audit --no-fund
npm --prefix frontend install --include=dev --no-audit --no-fund
npm run build

pm2 restart "$PM2_APP" --update-env

echo "[$(date '+%F %T')] Deployed ${remote_rev:0:7}"
