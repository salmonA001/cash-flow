# Architecture

## Components

```
              app.example.com (Vercel)            api.example.com / files.example.com (VPS)
              ┌─────────────────┐                 ┌──────────── Caddy (HTTPS) ────────────┐
 Browser ────►│  web (Next.js)  │   UI assets     │ api.   /api/*, /health → api          │
    │         └─────────────────┘                 │ files. → minio:9000 (presigned GET)   │
    │   fetch + cookies (same-site, CORS)         └──────────┬────────────────────────────┘
    └──────────────────────────────────────────────────────►│
                                                  ┌──────▼──────┐
                                                  │  api        │  NestJS, /api/v1
                                                  │  REST + auth│
                                                  └──┬───┬───┬──┘
                                                    │   │   │ enqueue
              Shopify / Printful webhooks ─────────►│   │   ▼
                                                    │   │ ┌───────┐   ┌──────────────┐
                                     ┌──────────────┘   │ │ Redis │◄──│ worker       │ BullMQ processors
                                     ▼                  │ └───────┘   │ + automation │──► Shopify GraphQL
                               ┌──────────┐             │      ▲      │   engine     │──► Printful REST
                               │PostgreSQL│◄────────────┼──────┼──────┤              │──► SMTP
                               └──────────┘             ▼      │      └──────────────┘
                                                   ┌───────┐   └── scheduler (repeatable jobs)
                                                   │ MinIO │
                                                   └───────┘
```

| Component | Responsibility |
| --- | --- |
| `apps/web` | UI only, hosted on Vercel. Calls the API directly at `NEXT_PUBLIC_API_URL` with credentials. Web and API are same-site subdomains, so `SameSite=Strict` session cookies (set on the API host) are sent; CORS allows only `APP_URL`. |
| `apps/api` | HTTP: authentication, authorization, validation, reads, and state changes that need no external call. Anything that calls a provider is **enqueued**. |
| `apps/worker` | All external side effects and ingestion: Shopify order sync, Printful submission/sync, entitlement grants + email, Amazon imports, reconciliation. |
| `apps/worker` scheduler | Registers repeatable maintenance jobs, then exits. |
| `packages/business-rules` | Pure, unit-tested domain logic shared by API and worker. No I/O. |
| `packages/integration-sdk` | Provider adapters behind interfaces (`FulfillmentProvider`), storage, crypto. |
| `packages/database` | Prisma schema, migrations, seed. |
| `packages/validation` | Zod schemas — the single definition of input rules, used by API pipes and web forms. |

## Layering inside the API

`Controller` (HTTP, DTO validation via `ZodPipe`, permission decorator) → `Service` (business logic, org scoping, audit) → `PrismaService` / `QueueService` / `StorageService`.

Global guards run in order: `ThrottlerGuard` → `OriginGuard` (CSRF) → `AuthGuard` (session + `@RequirePermission`). A global filter returns a consistent error envelope and maps Prisma errors (unique → 409, missing → 404).

## Data flows

### Shopify order → fulfillment / download

1. Shopify webhook → `POST /api/v1/webhooks/shopify`: HMAC verified, shop mapped to an organization, stored once as an `IntegrationEvent` (unique on the delivery ID), enqueued. Response in milliseconds.
2. Worker re-fetches the order **from the GraphQL Admin API** (the webhook body is never trusted for state), upserts customer, order, line items, payments (with Shopify Payments fees) and refunds — all keyed by Shopify IDs.
3. Each line item is classified by its mapped internal variant: `POD`, `DIGITAL`, or `UNCLASSIFIED` (never guessed).
4. **Order workflow** (idempotent, re-runnable):
   - unmapped items → review task;
   - paid order with POD items → eligibility check (payment, address, Printful variant, print file) → one `FulfillmentOrder` (`AWAITING_APPROVAL`), or a review task listing the reasons;
   - paid digital items → entitlement + emailed link;
   - full refund → revoke digital access; partial refund on digital items → review task;
   - cancelled order → cancel unsubmitted fulfillment tasks.
5. A human approves in **POD Fulfillment** → compare-and-set to `SUBMITTING` → single-attempt job → worker looks up the order at Printful **by idempotency key first**, creates a draft only if absent, confirms it. A timeout leaves the outcome unknown → `NEEDS_REVIEW`; retrying is safe because of step one.
6. Printful webhooks → status re-fetched from Printful → status, costs, tracking stored.

### Amazon Merch royalties

Upload → preview (parse + validate, nothing stored) → import: identical files rejected by checksum, original archived to `report-archives`, job queued → worker parses and inserts rows with `skipDuplicates` on `(organization, rowHash)` and maps rows to listings by ASIN + marketplace. Creating a listing later back-fills its royalties. A daily job reconciles paid Amazon payouts against royalties for the same period and currency.

### Finance

Every report is computed on read from source records: orders, refunds, payments (fees), fulfillment costs, royalties and expenses become ledger lines, converted to the base currency at the latest stored rate on or before each record's date. A missing rate fails the report (HTTP 422) instead of producing a silently wrong number. `computeContributions` applies the channel formulas and allocates shared costs by net-revenue share. Payouts are never revenue.

## Queues

| Queue | Producer | Retries | Notes |
| --- | --- | --- | --- |
| `integration-events` | webhooks | 5, exponential | idempotent upserts |
| `orders` | order remap in UI | 5, exponential | order workflow |
| `fulfillment` | approval | **1 (never auto-retried)** | concurrency 1 |
| `digital` | manual grant | 3 | entitlement + email; rotates token if the email never went out |
| `amazon-imports` | upload | 3 | dedupe makes re-runs safe |
| `maintenance` | scheduler | 3 | reconciliations, health alerts, temp cleanup |

## Automation levels

| Level | Meaning | Examples |
| --- | --- | --- |
| 1 — Automatic | Safe, repeatable, internal | classification, status sync, report processing, notifications |
| 2 — Approval required | External or financial effect | live Printful submission (+ refunds, price changes, listing publication, payout adjustments when added) |
| 3 — Human judgment | Never automated | design approval (IP/copyright), tax, legal, strategy |

Every automation writes an `AutomationRun` (status, input, output, error). Core workflow steps cannot be disabled; optional ones (auto-create fulfillment task, auto-grant downloads, refund revocation, integration alerts, reconciliation review tasks) can. Custom rules react to built-in triggers and may only notify or open review tasks.

## Key decisions

- **Web on Vercel, backend on the VPS** — Vercel serves the UI; long-running workers, Redis queues, Postgres and MinIO need a persistent host. The browser calls the API directly rather than through a Vercel rewrite: uploads up to 500 MB exceed Vercel's proxied request-body limit, and proxying would hide client IPs from the rate limiter.
- **Modular monolith** — one deployable per role, shared packages instead of network boundaries.
- **Provider payloads are references, not truth** — the worker always re-reads provider state.
- **Idempotency at the database** — unique constraints on provider IDs and row hashes, compare-and-set state transitions.
- **Fail loudly** — missing exchange rates, unknown provider statuses, unmapped items and misconfiguration stop the operation with a clear error instead of degrading silently.
