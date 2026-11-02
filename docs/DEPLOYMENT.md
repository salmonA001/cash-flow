# Deployment

The whole system runs on one Linux server with Docker Compose. Caddy terminates HTTPS and routes:

| Address | Serves |
| --- | --- |
| `APP_DOMAIN` | the web app, and the API under `/api/*` and `/health` |
| `FILES_DOMAIN` (`files.` + `APP_DOMAIN`) | presigned file downloads (MinIO S3 API) |

The web app and the API share one origin, so the `SameSite=Strict` session cookies are first-party and uploads (up to 500 MB) go straight to the API.

## 1. Free server (Oracle Cloud Always Free)

This costs nothing and needs no domain. The setup script gives the server the free address `https://<public-ip-with-dashes>.sslip.io` ([sslip.io](https://sslip.io) answers DNS for any name that contains an IP address), and Caddy obtains its HTTPS certificates.

| Part | Free plan | Limit to know |
| --- | --- | --- |
| Server | Oracle Cloud **Always Free** Ampere A1 (ARM) | 2 OCPU / 12 GB RAM / 200 GB disk in total. Sign-up checks a card; Always Free resources are never charged. Free capacity can be out of stock in a region; retry later. Oracle may reclaim an instance that stays idle for 7 days (CPU, network and memory all under 20%), so watch the account's email. |
| Email | **Gmail** SMTP with an app password | About 500 emails a day. |
| Address | **sslip.io** | Free. Move to your own domain at any time (below). |

**Email password first** (the setup needs it): Google Account → *Security* → turn on *2-Step Verification* → *App passwords* → create one named "Cash Flow" and copy its 16 letters without spaces.

**Create the server:**

1. Sign up at https://signup.oraclecloud.com. Choose the home region carefully; it can't be changed.
2. *Compute → Instances → Create instance*:
   - *Image and shape*: image **Canonical Ubuntu 24.04**, shape **VM.Standard.A1.Flex** with **2 OCPU** and **12 GB** memory.
   - *Networking*: keep "Create new virtual cloud network" and "Assign a public IPv4 address".
   - *Add SSH keys*: "Generate a key pair for me" and save the private key (only needed for maintenance).
   - *Boot volume*: "Specify a custom boot volume size", **150 GB** (uploaded files are stored here).
   - *Show advanced options → Management → Initialization script*: "Paste cloud-init script" and paste the script below with your values filled in.
   - **Create**.
3. *Networking → Virtual cloud networks →* the new network *→ Security Lists → Default Security List → Add Ingress Rules*: source CIDR `0.0.0.0/0`, IP protocol TCP, destination port range `80,443`.
4. Copy the instance's *Public IP address*, e.g. `129.146.10.20`. The first start builds everything and takes about 20 minutes. Then open `https://129-146-10-20.sslip.io` and sign in with your email and password.

```bash
#!/bin/bash
export HOME=/root
export ADMIN_EMAIL='you@gmail.com'
export ADMIN_PASSWORD='choose-12-or-more-characters'
export SMTP_URL='smtps://you%40gmail.com:YOURAPPPASSWORD@smtp.gmail.com:465'
export MAIL_FROM='Cash Flow Engine <you@gmail.com>'
git clone https://github.com/salmonA001/cash-flow.git /opt/cash-flow
cd /opt/cash-flow && infrastructure/setup-server.sh
```

In `SMTP_URL`, write the `@` of the Gmail address as `%40`. No value may contain a single quote. `infrastructure/setup-server.sh` opens ports 80 and 443 on the server, installs Docker, writes `/opt/cash-flow/.env` with fresh random secrets and starts the stack. Its output is in `/var/log/cloud-init-output.log`. Any other Ubuntu 24.04 server works the same way: run those lines as root.

**Your own domain later:** point `A` records for `app.example.com` and `files.example.com` at the server. In `/opt/cash-flow/.env` set `APP_DOMAIN=app.example.com`, `APP_URL` and `API_PUBLIC_URL` to `https://app.example.com`, `FILES_DOMAIN=files.example.com` and `MINIO_PUBLIC_ENDPOINT=https://files.example.com`. Then run `sudo docker compose up -d --build` in `/opt/cash-flow`. The web app is rebuilt because its API origin is fixed at build time.

**Shopify:** once you have created the Shopify app ([INTEGRATIONS.md](INTEGRATIONS.md)), set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` in `.env` and run `sudo docker compose up -d`.

## 2. First sign-in

Open the app (`https://<ip-with-dashes>.sslip.io`), sign in with the owner account, then:

1. Settings → Organization: base currency.
2. Settings → Integrations: connect Shopify and Printful; configure the Printful webhook URL shown there.
3. Products: map each variant to its Printful variant ID and print file, and its Shopify variant ID.
4. Run a test order on Shopify while **demo mode** is on; confirm it appears classified with a fulfillment task. Then turn demo mode off and approve one real order.

Monitoring (optional): `docker compose --profile monitoring up -d`, then `ssh -L 3001:localhost:3001 ubuntu@<server-ip>` and open http://localhost:3001 (Grafana, Prometheus datasource preconfigured).

## Migrations

The `migrate` service runs `prisma migrate deploy` and the idempotent seed on every `docker compose up`. To run manually: `docker compose run --rm migrate`.

## Backups

**Database** — nightly with cron, copy off-site:

```bash
crontab -e
# 15 2 * * *  cd /opt/cash-flow && infrastructure/postgres/backup.sh >> backups/backup.log 2>&1
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

On the server, in `/opt/cash-flow`:

```bash
sudo git pull
sudo docker compose up -d --build   # rebuilds web + backend, runs pending migrations first
```

- **Dependencies** are pinned exactly (`.npmrc save-exact`, `pnpm-lock.yaml`). To upgrade: `pnpm up --latest <pkg>` in the relevant package, read its changelog, run `pnpm build && pnpm test && pnpm test:e2e`, commit the lockfile.
- **Images** are pinned by tag in `docker-compose.yml`. Upgrade one at a time; take a backup before upgrading Postgres across major versions (requires dump/restore).
- **MinIO** no longer publishes community images, so `infrastructure/minio/Dockerfile` compiles the server and `mc` from their official GitHub source. To upgrade, set `MINIO_RELEASE` / `MC_RELEASE` to newer release tags and run `docker compose build minio`.
- **Shopify API version**: see [INTEGRATIONS.md](INTEGRATIONS.md#upgrading-the-shopify-api-version).

## Running everything on your own computer

`docker compose -f docker-compose.local.yml up --build` runs the complete system (web, API, worker, PostgreSQL, Redis, MinIO, a Mailpit inbox) on `localhost` with no `.env` file. See the README for addresses and the sign-in. It is for local use only; it has public passwords and listens on `127.0.0.1`.

## Local development (hot reload)

`npm run dev` (see the README) starts the Docker dependencies from `docker-compose.dev.yml`, prepares `.env`, the database and storage, and runs the API, worker and web app with hot reload. Ports bind to `127.0.0.1` only. The dev Postgres also creates the `cfe_test` and `cfe_worker_test` databases used by the test suites.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| API exits at start with "Invalid environment configuration" | The message lists every bad variable. |
| `/health` → `storage` error | `docker compose logs minio minio-init`; `MINIO_ENDPOINT` must be `http://minio:9000` inside compose. |
| Downloads/previews 403 from files domain | `MINIO_PUBLIC_ENDPOINT` must exactly match the browser URL (scheme + host) because it is part of the signature; check the files domain DNS. |
| Finance shows "Missing exchange rates" | Add the listed pairs in Finance → Exchange rates. |
| Orders not arriving | Settings → Integrations event counts; `docker compose logs worker`; Shopify app → Webhooks delivery log. The hourly reconciliation also back-fills. |
| Fulfillment stuck in `NEEDS_REVIEW` | Check the order in the Printful dashboard, then **Retry** (looks the order up before creating). |
| The address does not load | Ports 80/443 open in the security list (step 3); `sudo docker compose ps` in `/opt/cash-flow`; first-boot log `/var/log/cloud-init-output.log`. |
| Login always 401 / "Cross-origin request rejected" | Open the app at exactly `APP_URL` (scheme + host, no trailing slash); `COOKIE_SECURE=true` requires HTTPS. After changing `APP_URL`, run `sudo docker compose up -d --build`. |
| Jobs not running | `docker compose logs worker`; Redis must use `noeviction` (set in compose). |
