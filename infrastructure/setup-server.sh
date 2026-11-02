#!/usr/bin/env bash
# One-time backend setup on a fresh Ubuntu 24.04 server (e.g. Oracle Cloud Always Free).
# Run from the repository root:
#
#   sudo DOMAIN=example.com ADMIN_EMAIL=you@example.com \
#        SMTP_URL='smtp://login%40example.com:KEY@smtp-relay.brevo.com:587' \
#        MAIL_FROM='Cash Flow Engine <downloads@example.com>' \
#        infrastructure/setup-server.sh
#
# Opens ports 80/443, installs Docker, writes .env with fresh random secrets and starts the stack.
# The web app is expected at https://app.$DOMAIN, the API at https://api.$DOMAIN, files at https://files.$DOMAIN.
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=example.com}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL (the first owner login)}"
: "${SMTP_URL:?Set SMTP_URL (see docs/DEPLOYMENT.md → Free hosting)}"
: "${MAIL_FROM:?Set MAIL_FROM, e.g. MAIL_FROM=\"Cash Flow Engine <downloads@$DOMAIN>\"}"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -f docker-compose.yml ] || { echo "Run from the repository root." >&2; exit 1; }
[ ! -e .env ] || { echo ".env already exists; refusing to overwrite its secrets. Use 'docker compose up -d --build'." >&2; exit 1; }

# Oracle's Ubuntu image rejects inbound traffic in iptables except SSH.
iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 iptables-persistent openssl
netfilter-persistent save

hex() { openssl rand -hex 24; }
POSTGRES_PASSWORD=$(hex)
REDIS_PASSWORD=$(hex)
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')

umask 077
cat > .env <<EOF
APP_URL=https://app.$DOMAIN
API_DOMAIN=api.$DOMAIN
API_PUBLIC_URL=https://api.$DOMAIN
COOKIE_SECURE=true

POSTGRES_USER=cfe
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=cfe
DATABASE_URL=postgresql://cfe:$POSTGRES_PASSWORD@postgres:5432/cfe?schema=public

REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379/0

JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

MINIO_ROOT_USER=cfe-admin
MINIO_ROOT_PASSWORD=$(hex)
MINIO_ACCESS_KEY=cfe-app
MINIO_SECRET_KEY=$(hex)
MINIO_ENDPOINT=http://minio:9000
MINIO_PUBLIC_ENDPOINT=https://files.$DOMAIN
MINIO_REGION=us-east-1
FILES_DOMAIN=files.$DOMAIN

# Replace when you create the Shopify app (docs/INTEGRATIONS.md), then: docker compose up -d
SHOPIFY_CLIENT_ID=not-configured
SHOPIFY_CLIENT_SECRET=not-configured
PRINTFUL_WEBHOOK_SECRET=$(hex)

SMTP_URL=$SMTP_URL
MAIL_FROM="$MAIL_FROM"

SEED_ORG_NAME="Cash Flow Engine"
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD=$ADMIN_PASSWORD

GRAFANA_ADMIN_PASSWORD=$(hex)
EOF

docker compose up -d --build

cat <<EOF

Backend started. Next:
  1. DNS A records → this server's public IP:  api.$DOMAIN  files.$DOMAIN
  2. GitHub variable NEXT_PUBLIC_API_URL = https://api.$DOMAIN, then run "Deploy web to Vercel".
  3. In Vercel add the domain app.$DOMAIN to project cash-flow-web.
  Check: curl https://api.$DOMAIN/health

First sign-in:  $ADMIN_EMAIL  /  $ADMIN_PASSWORD
Save this password and back up .env (it holds ENCRYPTION_KEY) in a password manager.
EOF
