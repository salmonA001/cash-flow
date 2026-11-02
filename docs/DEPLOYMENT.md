# Deployment

The system runs in two places:

| Where | What | Domain (example) |
| --- | --- | --- |
| **Vercel** | Next.js web app (`apps/web`) | `app.example.com` |
| **VPS** (Docker Compose) | API, worker, scheduler, PostgreSQL, Redis, MinIO, Caddy | `api.example.com`, `files.example.com` |

**The web and API domains must be subdomains of the same registered domain.** Session cookies are `SameSite=Strict` and live on the API host; the browser only sends them when the page and the API are the same site. Vercel's `*.vercel.app` preview URLs are a different site, so you can't sign in on previews. Use the custom domain.

## 1. VPS (backend)

Requirements:

- Ubuntu 24.04 LTS (or any Linux with Docker Engine 27+ and the Compose plugin)
- 2 vCPU / 4 GB RAM minimum; disk sized for design files and digital products (MinIO data)
- DNS: `A` records for `API_DOMAIN` (`api.example.com`) and `FILES_DOMAIN` (`files.example.com`) → the VPS
- Firewall: allow 22, 80, 443 only

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
git clone <your-repo> cash-flow && cd cash-flow
cp .env.example .env
nano .env
```

Set at least:

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://app.example.com` (the Vercel domain — only origin allowed by CORS) |
| `API_DOMAIN`, `API_PUBLIC_URL` | `api.example.com`, `https://api.example.com` |
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
docker compose ps            # all healthy; migrate / minio-init / scheduler "exited (0)"
curl https://api.example.com/health
```

Caddy obtains and renews Let's Encrypt certificates automatically once DNS resolves.

## 2. Vercel (web app) — deployed by GitHub Actions

`.github/workflows/deploy-web.yml` deploys `apps/web` to Vercel on every push to the repository's **default branch** that touches the web app or its shared packages, and on demand (Actions → *Deploy web to Vercel* → *Run workflow*). It creates the Vercel project `cash-flow-web` on the first run, builds in GitHub Actions (where the whole pnpm monorepo is available) and uploads the prebuilt output. Vercel's own Git-triggered builds are turned off in `apps/web/vercel.json`, so every deployment comes from this one workflow.

One-time setup:

1. **Vercel token** — https://vercel.com/account/tokens → *Create*. Scope it to the account or team that should own the project.
2. **GitHub** → repository → *Settings → Secrets and variables → Actions*:
   - *Secrets* → **New repository secret**: `VERCEL_TOKEN` = the token.
   - *Variables* → **New repository variable**: `NEXT_PUBLIC_API_URL` = `https://api.example.com`.
3. *Actions* → *Deploy web to Vercel* → **Run workflow**. The run summary shows the deployment URL. The production URL is `https://cash-flow-web.vercel.app` unless that name is taken.
4. Vercel → project `cash-flow-web` → *Settings → Domains*: add `app.example.com` and create the DNS record Vercel shows (usually a `CNAME` to `cname.vercel-dns.com`).
5. Make sure `APP_URL` in the VPS `.env` is exactly `https://app.example.com`, and run `docker compose up -d` if you changed it.

`NEXT_PUBLIC_API_URL` is inlined at build time, so changing it needs a new run. Sign-in only works on the custom domain (same site as the API), not on `*.vercel.app`.

## 3. First sign-in

Open `https://app.example.com`, sign in with the seed owner, then:

1. Settings → Organization: base currency.
2. Settings → Integrations: connect Shopify and Printful; configure the Printful webhook URL shown there (it points at the API domain).
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

Backend (VPS):

```bash
git pull
docker compose build
docker compose up -d          # runs pending migrations first
```

Web (Vercel): the GitHub Actions workflow redeploys on push to the default branch. Deploy the backend first when an API change and a UI change depend on each other.

- **Dependencies** are pinned exactly (`.npmrc save-exact`, `pnpm-lock.yaml`). To upgrade: `pnpm up --latest <pkg>` in the relevant package, read its changelog, run `pnpm build && pnpm test && pnpm test:e2e`, commit the lockfile.
- **Images** are pinned by tag in `docker-compose.yml`. Upgrade one at a time; take a backup before upgrading Postgres across major versions (requires dump/restore).
- **MinIO** no longer publishes community images, so `infrastructure/minio/Dockerfile` compiles the server and `mc` from their official GitHub source. To upgrade, set `MINIO_RELEASE` / `MC_RELEASE` to newer release tags and run `docker compose build minio`.
- **Shopify API version**: see [INTEGRATIONS.md](INTEGRATIONS.md#upgrading-the-shopify-api-version).

## Running everything on your own computer

`docker compose -f docker-compose.local.yml up --build` runs the complete system (web, API, worker, PostgreSQL, Redis, MinIO, a Mailpit inbox) on `localhost` with no `.env` file. See the README for addresses and the sign-in. It is for local use only; it has public passwords and listens on `127.0.0.1`.

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
| Login always 401 / bounces back to /login | Web and API must share a registered domain (not `*.vercel.app`); `COOKIE_SECURE=true` requires HTTPS; `APP_URL` must exactly match the browser origin. |
| Browser console: CORS error | `APP_URL` on the VPS must equal the web origin exactly (scheme + host, no trailing slash); restart `api` after changing it. |
| Deploy workflow fails at "Check configuration" | Add the `VERCEL_TOKEN` secret and the `NEXT_PUBLIC_API_URL` variable in GitHub, then re-run the workflow. |
| Deploy workflow fails creating or linking the project | The token must belong to the account or team that owns (or should own) `cash-flow-web`; create a new token there. |
| Jobs not running | `docker compose logs worker`; Redis must use `noeviction` (set in compose). |
