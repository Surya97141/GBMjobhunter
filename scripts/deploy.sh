#!/bin/bash
# Deploy script — run from /var/www/gbm/app on the VPS.
# Safe to run on every deploy: migrations are idempotent, docker compose up is incremental.
set -e

APP_DIR="/var/www/gbm/app"
WEB_DIST="/var/www/gbm/web/dist"

cd "$APP_DIR"

# Load .env so POSTGRES_* vars are available for the migration command below.
set -a
source .env
set +a

echo "=== [1/6] Pull latest code ==="
git pull origin main

echo "=== [2/6] Build frontend ==="
cd web
npm ci
# VITE_API_URL is relative — Caddy routes /api/* to the gateway on the same domain.
VITE_API_URL=/api npm run build
cd "$APP_DIR"

echo "=== [3/6] Copy static build to web root ==="
rm -rf "$WEB_DIST"
cp -r web/dist/. "$WEB_DIST/"

echo "=== [4/6] Update Caddy config ==="
cp Caddyfile /etc/caddy/Caddyfile

echo "=== [5/6] Rebuild and restart services ==="
# --build rebuilds service images. Base images (postgres, redis) use cached layers
# unless their digest changed.
docker compose build --pull
docker compose up -d

echo "Waiting for Postgres to be ready..."
until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null; do
  sleep 1
done

echo "=== [6/6] Run migrations ==="
# Runs on the host via 127.0.0.1:5432 (postgres is bound to localhost only).
# All migrations use IF NOT EXISTS / ON CONFLICT — safe to run every deploy.
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}" \
  node scripts/migrate.js

echo "=== Reload Caddy ==="
systemctl reload caddy

echo ""
echo "=== Deploy complete ==="
