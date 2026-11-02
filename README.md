# Cash Flow Engine OS

A self-hosted operating system for a print-on-demand and digital-commerce business with three revenue channels:

| Channel | How it works here |
| --- | --- |
| **Amazon Merch on Demand** | Design records, listing references (ASINs), CSV royalty-report import with validation, de-duplication and payout reconciliation. No scraping, no unsupported automation. |
| **Shopify + Printful** | Shopify orders synced from the GraphQL Admin API (webhooks + hourly reconciliation), classified per line item, and fulfilled through Printful behind an explicit human approval. |
| **Digital downloads** | Private files in MinIO, server-side payment verification, hashed single-purpose tokens, expiring and count-limited links, revocation on refund. |

Built as a **modular monolith**: Next.js web app → NestJS REST API → business modules → provider adapters, with BullMQ workers for everything that touches the outside world.

**Run it on your computer** with one command (below). **For real store traffic**, the whole system runs on one server with Docker Compose. It can be completely free: an Oracle Cloud Always Free server, a free `sslip.io` address (no domain to buy) and Gmail for email. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

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
| One-server production setup (`infrastructure/setup-server.sh`, web + API on one origin behind Caddy) | ✅ sign-in, saving and session refresh verified through the production Caddyfile; first run on a real server pending |
| One-command local stack (`docker-compose.local.yml`) | ✅ built and run end to end: browser suite, real MinIO uploads + presigned downloads, worker email delivery, download limits, Amazon import, restart persistence |
| MinIO image built from official source (Docker Hub images were withdrawn) | ✅ |
| Docker Compose for the server (Postgres, Redis, MinIO, web, API, worker, scheduler, Caddy, monitoring) | ✅ config-validated (same images as the local stack) |

**Test suite:** 30 business-rule unit tests · 12 integration-SDK tests · 28 API end-to-end tests (real Postgres + Redis) · 12 worker integration tests · 11 Playwright browser tests (desktop + mobile).

**Not yet verified against live services:** Shopify and Printful are exercised through test doubles, and no production server has been set up yet. Do a staging run with real sandbox credentials before turning off demo mode. See [Next stages](#next-stages).

## Run it on your computer (one command)

Prerequisite: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS) or Docker Engine (Linux).

```bash
git clone https://github.com/salmonA001/cash-flow.git
cd cash-flow
docker compose -f docker-compose.local.yml up --build
```

The first build takes a few minutes (it compiles MinIO from source). Then open:

| What | Address | Sign in |
| --- | --- | --- |
| **The app** | http://localhost:3000 | `owner@example.com` / `local-password-123` |
| Email inbox (download links) | http://localhost:8025 | — |
| File storage console | http://localhost:9001 | `cfe-admin` / `local-minio-admin` |

Stop with `Ctrl+C` (or `docker compose -f docker-compose.local.yml down`). Your data is kept in Docker volumes; add `-v` to `down` to erase it.

This is for your own computer only: its passwords are public, every port listens on `127.0.0.1` only, and the organization starts in demo mode. Shopify and Printful can't send webhooks to `localhost`, so live store orders need the server setup in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Development (hot reload)

Prerequisites: [Node.js 22.9+](https://nodejs.org) and Docker Desktop (running).

```bash
npm run dev
```

That one command (Windows, macOS and Linux):

1. creates `.env` with local settings and fresh secrets, the first time only (an existing `.env` is never changed);
2. starts PostgreSQL, Redis, MinIO and Mailpit in Docker (`docker-compose.dev.yml`);
3. installs dependencies (pnpm via corepack: no global install, no `npm install` needed), builds the shared packages, applies migrations and seeds the owner account;
4. runs the API, worker and web app with hot reload, with output prefixed `api │`, `worker │` and `web │`.

Then open http://localhost:3000 and sign in with `owner@example.com` / `local-password-123`. Download-link emails go to http://localhost:8025.

`Ctrl+C` stops the apps; the databases keep running for a fast restart. Stop them with `docker compose -f docker-compose.dev.yml down` (add `-v` to erase local data). After changing anything in `packages/`, restart `npm run dev` so the shared packages are rebuilt.

## Tests

```bash
corepack pnpm test       # unit + integration (needs the dev Postgres + Redis from `npm run dev`; uses cfe_test / cfe_worker_test DBs)
corepack pnpm test:e2e   # Playwright against a running app (E2E_EMAIL / E2E_PASSWORD = seeded owner)
```

The API and worker suites recreate their own `*_test` databases and refuse to touch any other database.

## Production

Create a free Oracle Cloud server and paste the setup script as its cloud-init script; it installs Docker, writes `.env` with fresh secrets and starts everything at `https://<ip-with-dashes>.sslip.io` with automatic HTTPS. Step by step: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Repository layout

```
apps/
  web/        Next.js 15 app router UI (Tailwind 4, shadcn-style components, Recharts, RHF + Zod)
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
- [Deployment](docs/DEPLOYMENT.md) — free server setup, HTTPS, backups, restore, upgrades, troubleshooting

## Next stages

1. **Staging validation** — connect a Shopify development store and a Printful account; run real orders end to end in demo mode, then one live order.
2. **Shopify product/variant sync** — pull catalog changes (`products/update` is acknowledged but currently ignored by design).
3. **Shopify Payments payouts** — import balance transactions to reconcile Shopify payouts the way Amazon payouts are.
4. **Printful catalog browser** — pick variants from the catalog in the UI instead of entering IDs.
5. **Automatic FX rates** — scheduled import from a chosen rate provider (rates are entered manually today).
6. **CI pipeline** — build images, run all suites against service containers.
