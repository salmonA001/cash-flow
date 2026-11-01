# Deployment

## VPS requirements

- Ubuntu 24.04 LTS (or any Linux with Docker Engine 27+ and the Compose plugin)
- 2 vCPU / 4 GB RAM minimum; disk sized for design files and digital products (MinIO data)
- DNS: `A` records for `APP_DOMAIN` (e.g. `app.example.com`) and `FILES_DOMAIN` (e.g. `files.example.com`) → the VPS
- Firewall: allow 22, 80, 443 only

## First deployment

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
git clone <your-repo> cash-flow && cd cash-flow
cp .env.example .env
nano .env
```

Set at least:

| Variable | Value |
| --- | --- |
| `APP_DOMAIN`, `APP_URL` | `app.example.com`, `https://app.example.com` |
| `FILES_DOMAIN`, `MINIO_PUBLIC_ENDPOINT` | `files.example.com`, `https://files.example.com` |
| `COOKIE_SECURE` | `true` |
| `POSTGRES_PASSWORD` + the same in `DATABASE_URL` | `openssl rand -hex 24` |
| `REDIS_PASSWORD` + the same in `REDIS_URL` | `openssl rand -hex 24` |
| `JWT_SECRET`, `ENCRYPTION_KEY` | `openssl rand -base64 32` (each) |
| `MINIO_ROOT_PASSWORD`, `MINIO_SECRET_KEY` | different random values |
| `PRINTFUL_WEBHOOK_SECRET` | `openssl rand -hex 24` |
| `SHOPIFY_CLIENT_ID/SECRET` | from your Shopify app |
| `SMTP_URL`, `MAIL_FROM` | your mail provider |
| `SEED_ADMIN_EMAIL/PASSWORD` | first owner account |

```bash
docker compose up -d --build
docker compose ps            # all services healthy; migrate/minio-init/scheduler "exited (0)"
docker compose logs -f api worker
```

Caddy obtains and renews Let's Encrypt certificates automatically once DNS resolves. Open `https://app.example.com`, sign in, then:

1. Settings → Organization: base currency.
2. Settings → Integrations: connect Shopify and Printful; configure the Printful webhook URL shown there.
3. Products: map each variant to its Printful variant ID and print file, and its Shopify variant ID.
4. Run a test order on Shopify while **demo mode** is on; confirm it appears classified with a fulfillment task. Then turn demo mode off and approve one real order.

Monitoring (optional): `docker compose --profile monitoring up -d`, then `ssh -L 3001:localhost:3001 user@vps` and open http://localhost:3001 (Grafana, Prometheus datasource preconfigured).

## Migrations

The `migrate` service runs `prisma migrate deploy` and the idempotent seed on every `docker compose up`. To run manually: `docker compose run --rm migrate`.

## Backups

**Database** — nightly with cron, copy off-site:

```bash
crontab -e
# 15 2 * * *  cd /home/deploy/cash-flow && infrastructure/postgres/backup.sh >> backups/backup.log 2>&1
```

**Object storage** — mirror MinIO to another S3-compatible target (versioning is enabled on originals, exports, digital products and report archives):

```bash
docker compose run --rm --entrypoint sh minio-init -c \
  'mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && \
   mc alias set offsite https://s3.example.com KEY SECRET && \
   mc mirror --overwrite local offsite/cfe-backup'
```

**Secrets** — store `.env` (especially `ENCRYPTION_KEY`) in a password manager. Without `ENCRYPTION_KEY` stored integration tokens cannot be decrypted.

## Restore

```bash
infrastructure/postgres/restore.sh backups/postgres/cfe-20261101T021500Z.dump
```

Restore MinIO with `mc mirror offsite/cfe-backup local`. Test a restore on a separate machine quarterly.

## Upgrades

```bash
git pull
docker compose build
docker compose up -d          # runs pending migrations first
```

- **Dependencies** are pinned exactly (`.npmrc save-exact`, `pnpm-lock.yaml`). To upgrade: `pnpm up --latest <pkg>` in the relevant package, read its changelog, run `pnpm build && pnpm test && pnpm test:e2e`, commit the lockfile.
- **Images** are pinned by tag in `docker-compose.yml`. Upgrade one at a time; take a backup before upgrading Postgres across major versions (requires dump/restore).
- **Shopify API version**: see [INTEGRATIONS.md](INTEGRATIONS.md#upgrading-the-shopify-api-version).

## Local development with Docker dependencies

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres, Redis, MinIO (+ init), Mailpit
```

Ports bind to `127.0.0.1` only. The dev Postgres also creates the `cfe_test` and `cfe_worker_test` databases used by the test suites. See the README for the full Linux and PowerShell command sequence.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| API exits at start with "Invalid environment configuration" | The message lists every bad variable. |
| `/health` → `storage` error | `docker compose logs minio minio-init`; `MINIO_ENDPOINT` must be `http://minio:9000` inside compose. |
| Downloads/previews 403 from files domain | `MINIO_PUBLIC_ENDPOINT` must exactly match the browser URL (scheme + host) because it is part of the signature; check the files domain DNS. |
| Finance shows "Missing exchange rates" | Add the listed pairs in Finance → Exchange rates. |
| Orders not arriving | Settings → Integrations event counts; `docker compose logs worker`; Shopify app → Webhooks delivery log. The hourly reconciliation also back-fills. |
| Fulfillment stuck in `NEEDS_REVIEW` | Check the order in the Printful dashboard, then **Retry** (looks the order up before creating). |
| Login always 401 behind a proxy | `COOKIE_SECURE=true` requires HTTPS end to end; `APP_URL` must match the browser origin exactly. |
| Jobs not running | `docker compose logs worker`; Redis must use `noeviction` (set in compose). |
