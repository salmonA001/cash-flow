#!/usr/bin/env bash
# One-time setup of the whole system on a fresh Ubuntu 24.04 server (e.g. Oracle Cloud Always Free).
# Paste-able as the server's cloud-init script (docs/DEPLOYMENT.md), or run from the repository root:
#
#   sudo ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-12-chars' \
#        SMTP_URL='smtps://you%40gmail.com:APPPASSWORD@smtp.gmail.com:465' \
#        MAIL_FROM='Cash Flow Engine <you@gmail.com>' \
#        infrastructure/setup-server.sh
#
# The app is served at the free address https://<public-ip-with-dashes>.sslip.io (no domain to buy);
# Caddy obtains its HTTPS certificates. Opens ports 80/443, installs Docker, writes .env with fresh
# random secrets and starts the stack.
set -euo pipefail

: "${ADMIN_EMAIL:?Set ADMIN_EMAIL (the first owner login)}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD (the first owner password, 12+ characters)}"
: "${SMTP_URL:?Set SMTP_URL (see docs/DEPLOYMENT.md)}"
: "${MAIL_FROM:?Set MAIL_FROM, e.g. MAIL_FROM=\"Cash Flow Engine <you@gmail.com>\"}"
[ "${#ADMIN_PASSWORD}" -ge 12 ] || { echo "ADMIN_PASSWORD must be at least 12 characters." >&2; exit 1; }
for v in ADMIN_EMAIL ADMIN_PASSWORD SMTP_URL MAIL_FROM; do
  [[ "${!v}" != *"'"* ]] || { echo "$v must not contain a single quote (')." >&2; exit 1; }
done
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -f docker-compose.yml ] || { echo "Run from the repository root." >&2; exit 1; }
[ ! -e .env ] || { echo ".env already exists; refusing to overwrite its secrets. Use 'docker compose up -d --build'." >&2; exit 1; }

PUBLIC_IP=$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')
[[ "$PUBLIC_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Could not determine the public IPv4 address (got '$PUBLIC_IP')." >&2; exit 1; }
DOMAIN="${PUBLIC_IP//./-}.sslip.io"

# First boot: wait for unattended-upgrades to release the dpkg lock instead of failing.
export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -o DPkg::Lock::Timeout=900)
"${APT[@]}" update
"${APT[@]}" install -y iptables-persistent openssl
# Oracle's Ubuntu image rejects inbound traffic in iptables except SSH. Saved before Docker
# is installed so Docker's own rules are not persisted.
iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
netfilter-persistent save
"${APT[@]}" install -y docker.io docker-buildx docker-compose-v2

hex() { openssl rand -hex 24; }
POSTGRES_PASSWORD=$(hex)
REDIS_PASSWORD=$(hex)

umask 077
cat > .env <<EOF
APP_DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
API_PUBLIC_URL=https://$DOMAIN
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

SMTP_URL='$SMTP_URL'
MAIL_FROM='$MAIL_FROM'

SEED_ORG_NAME="Cash Flow Engine"
SEED_ADMIN_EMAIL=$ADMIN_EMAIL
SEED_ADMIN_PASSWORD='$ADMIN_PASSWORD'

GRAFANA_ADMIN_PASSWORD=$(hex)
EOF

docker compose up -d --build

cat <<EOF

The app is starting at  https://$DOMAIN
Sign in with $ADMIN_EMAIL and the password you chose.
Ports 80 and 443 must also be open in the cloud firewall (Oracle: the subnet's security list).
Back up $(pwd)/.env in a password manager: it holds ENCRYPTION_KEY.
EOF
