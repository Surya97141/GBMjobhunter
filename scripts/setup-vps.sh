#!/bin/bash
# One-time setup for a fresh Ubuntu 22.04 VPS (Hetzner CX22 or equivalent).
# Run as root: bash scripts/setup-vps.sh
set -e

echo "=== GBM VPS Setup ==="

# ── System update ─────────────────────────────────────────────────────────────
apt-get update -y
apt-get upgrade -y

# ── Docker (official Docker apt repository) ───────────────────────────────────
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker

# ── Caddy (official Caddy apt repository) ─────────────────────────────────────
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy
systemctl enable caddy

# ── Node.js 20 (for running migrations on the host) ───────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# ── Firewall ──────────────────────────────────────────────────────────────────
apt-get install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Port 3000 (gateway) and 5432 (postgres) are bound to 127.0.0.1 — no rule needed.
ufw --force enable

# ── Web root ──────────────────────────────────────────────────────────────────
mkdir -p /var/www/gbm/web/dist

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. git clone <your-repo-url> /var/www/gbm/app"
echo "  2. cd /var/www/gbm/app"
echo "  3. cp .env.production .env  — then fill in all blank secrets"
echo "  4. Edit Caddyfile — replace 'your-domain.com' with your real domain"
echo "  5. Point your domain's DNS A record to this VPS IP, then:"
echo "     bash scripts/deploy.sh"
