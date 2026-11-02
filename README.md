# Cash Flow Engine OS

A self-hosted operating system for a print-on-demand and digital-commerce business with three revenue channels:

| Channel | How it works here |
| --- | --- |
| **Amazon Merch on Demand** | Design records, listing references (ASINs), CSV royalty-report import with validation, de-duplication and payout reconciliation. No scraping, no unsupported automation. |
| **Shopify + Printful** | Shopify orders synced from the GraphQL Admin API (webhooks + hourly reconciliation), classified per line item, and fulfilled through Printful behind an explicit human approval. |
| **Digital downloads** | Private files in MinIO, server-side payment verification, hashed single-purpose tokens, expiring and count-limited links, revocation on refund. |

Built as a **modular monolith**: Next.js web app → NestJS REST API → business modules → provider adapters, with BullMQ workers for everything that touches the outside world.

**Hosting:** the web app runs on **Vercel**; the API, worker, PostgreSQL, Redis and MinIO run on your **VPS** with Docker Compose. The two must share a registered domain (e.g. `app.example.com` on Vercel, `api.example.com` on the VPS).

## Status: Stage 1 (foundation) — complete and tested

| Area | State |
| --- | --- |
| Database schema (37 models), migrations, seed | ✅ |
| Finance engine (contributions, allocation, FX with stored rates) | ✅ unit-tested |
| Auth (Argon2id, rotating refresh sessions), RBAC, org isolation, CSRF, rate limits, audit log | ✅ e2e-tested |
| Designs, collections, versioned assets, approval gate | ✅ |
| Products, variants, Printful/Shopify variant mapping, listings | ✅ |
| Shopify OAuth, signed webhooks, order sync, refunds, reconciliation | ✅ (against test doubles — see below) |
| Printful adapter, approval-gated idempotent submission, status webhooks | ✅ (against test doubles) |
| Digital products, file versions, entitlements, email delivery, revocation | ✅ |
| Amazon Merch CSV preview/import, royalty mapping, payout reconciliation | ✅ |
| Automation engine (12 built-in automations, custom rules, execution log, safe retry) | ✅ |
| Web UI for all 14 sections, light/dark, responsive | ✅ Playwright-tested |
| Vercel deployment via GitHub Actions (`.github/workflows/deploy-web.yml`) | ✅ `vercel build` verified on a clean checkout; first live run needs your `VERCEL_TOKEN` |
| Docker Compose for the VPS (Postgres, Redis, MinIO, API, worker, scheduler, Caddy, monitoring) | ✅ config-validated |

**Test suite:** 30 business-rule unit tests · 12 integration-SDK tests · 28 API end-to-end tests (real Postgres + Redis) · 12 worker integration tests · 11 Playwright browser tests (desktop + mobile).

**Not yet verified against live services:** Shopify, Printful and SMTP are exercised through test doubles; MinIO through an in-memory double; the Docker images have not been built in CI, and no Vercel deployment has been made yet. Do a staging run with real sandbox credentials before turning off demo mode. See [Next stages](#next-stages).

## Quick start (local development)

Prerequisites: Node.js ≥ 22.9, pnpm 10 (`corepack enable`), Docker.

**Linux / macOS**

```bash
cp .env.example .env
# For local dev, set in .env:
#   DATABASE_URL=postgresql://cfe:cfe@localhost:5432/cfe?schema=public
#   REDIS_URL=redis://localhost:6379/0
#   MINIO_ENDPOINT=http://localhost:9000  MINIO_PUBLIC_ENDPOINT=http://localhost:9000
#   MINIO_ACCESS_KEY=cfe-app  MINIO_SECRET_KEY=cfe-app-dev-password
#   SMTP_URL=smtp://localhost:1025
#   APP_URL=http://localhost:3000  API_PUBLIC_URL=http://localhost:4000  NEXT_PUBLIC_API_URL=http://localhost:4000
#   JWT_SECRET / ENCRYPTION_KEY: openssl rand -base64 32
docker compose -f docker-compose.dev.yml up -d   # Postgres, Redis, MinIO, Mailpit
pnpm install
pnpm build
pnpm db:deploy && pnpm db:seed
pnpm dev:api        # terminal 1 → http://localhost:4000
pnpm dev:worker     # terminal 2
pnpm dev:scheduler  # once, registers maintenance schedules
pnpm dev:web        # terminal 3 → http://localhost:3000
```

**Windows (PowerShell)**

```powershell
Copy-Item .env.example .env
# Edit .env as above. Generate secrets with:
#   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
docker compose -f docker-compose.dev.yml up -d
corepack enable
pnpm install
pnpm build
pnpm db:deploy; pnpm db:seed
pnpm dev:api      # separate PowerShell windows for each
pnpm dev:worker
pnpm dev:scheduler
pnpm dev:web
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. The organization starts in **demo mode**: no live external action (Printful submission) can run until you switch it off in Settings.

Download-link emails land in Mailpit at http://localhost:8025.

## Tests

```bash
pnpm test        # unit + integration (needs the dev Postgres + Redis; uses cfe_test / cfe_worker_test DBs)
pnpm test:e2e    # Playwright against a running stack (E2E_EMAIL / E2E_PASSWORD = seeded owner)
```

The API and worker suites recreate their own `*_test` databases and refuse to touch any other database.

## Production

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md):

1. **VPS** — `cp .env.example .env`, fill secrets, point `api.` and `files.` DNS at the VPS, `docker compose up -d --build`. Caddy obtains HTTPS certificates automatically.
2. **Vercel (via GitHub Actions)** — add the repository secret `VERCEL_TOKEN` and the variable `NEXT_PUBLIC_API_URL=https://api.example.com`, then run *Actions → Deploy web to Vercel*. Every later push to the default branch redeploys. Attach the custom domain `app.example.com` in Vercel.

## Repository layout

```
apps/
  web/        Next.js 15 app router UI (Tailwind 4, shadcn-style components, Recharts, RHF + Zod) — deployed to Vercel
  api/        NestJS 11 REST API (/api/v1) — controllers, services, guards
  worker/     BullMQ processors, automation engine, scheduler
packages/
  database/        Prisma schema, migrations, seed
  business-rules/  Pure domain logic: finance, FX, eligibility, entitlements, Merch report parser, permissions
  integration-sdk/ Shopify, Printful, MinIO storage, file validation, credential encryption
  validation/      Zod schemas shared by API and web
  shared-types/    Queue names, job payloads, API response types
infrastructure/    Backend Dockerfile, Caddyfile, MinIO init, Postgres backup/restore, Prometheus/Grafana
docs/              Architecture, database, API, integrations, security, deployment
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flows, queues, automation levels
- [Database](docs/DATABASE.md) — entities, money rules, constraints, migrations
- [API](docs/API.md) — conventions and endpoint reference
- [Integrations](docs/INTEGRATIONS.md) — Shopify, Printful, Amazon Merch, email; API-version upgrades
- [Security](docs/SECURITY.md) — threat model and controls
- [Deployment](docs/DEPLOYMENT.md) — VPS, HTTPS, backups, restore, upgrades, troubleshooting

## Next stages

1. **Staging validation** — connect a Shopify development store and a Printful account; run real orders end to end in demo mode, then one live order.
2. **Shopify product/variant sync** — pull catalog changes (`products/update` is acknowledged but currently ignored by design).
3. **Shopify Payments payouts** — import balance transactions to reconcile Shopify payouts the way Amazon payouts are.
4. **Printful catalog browser** — pick variants from the catalog in the UI instead of entering IDs.
5. **Automatic FX rates** — scheduled import from a chosen rate provider (rates are entered manually today).
6. **CI pipeline** — build images, run all suites against service containers.
