# Database

PostgreSQL 16 via Prisma 6. Schema: `packages/database/prisma/schema.prisma`. Migrations: `packages/database/prisma/migrations`.

## Rules

1. **Money is `Decimal(14,2)`**, never float. Exchange rates are `Decimal(18,8)`. Calculations use `decimal.js` with banker's rounding.
2. **Original currency is preserved** on every financial row (`amount` + `currency`). Conversion happens at report time using `ExchangeRate` rows; the rate and date used are reproducible.
3. **Organization scoping** — every org-owned table has `organizationId`; every query filters by it. Records from another organization return 404.
4. **Provider IDs are unique** — e.g. `Order(organizationId, source, externalId)`, `Payment(organizationId, provider, externalId)`, `Refund(organizationId, externalId)`, `IntegrationEvent(organizationId, provider, eventId)`, `RoyaltyTransaction(organizationId, rowHash)`, `FulfillmentOrder(organizationId, idempotencyKey)` and `(orderId, provider)`.
5. **Amazon royalties live in `RoyaltyTransaction`**, separate from Shopify `Order` revenue.
6. **Payouts are cash movements** (`Payout`), never revenue.

## Entity map

| Area | Models |
| --- | --- |
| Identity & access | Organization, User, Role, Permission, RolePermission, RefreshSession |
| Design studio | Design, DesignVersion, DesignAsset, Collection, DesignCollection |
| Catalog | Product, ProductVariant, MarketplaceListing |
| Commerce | Customer, Order, OrderItem, Payment, Refund |
| Fulfillment | FulfillmentOrder, FulfillmentEvent |
| Digital | DigitalProduct, DownloadAsset, DownloadEntitlement, DownloadEvent |
| Amazon Merch | AmazonReportImport, RoyaltyTransaction |
| Finance | Payout, Expense, ExchangeRate (global market data) |
| Automation | AutomationRule, AutomationRun |
| Integrations | IntegrationCredential (AES-256-GCM encrypted secret), IntegrationEvent |
| Oversight | AuditLog, Notification, ReviewTask |

Relationships required by the business model: one design → many products and listings; one product → many variants and listings; one order → POD and digital items together; one order item → at most one entitlement.

## Deletion policies

- Aggregate children cascade: design versions/assets, order items, product variants, file versions, events.
- Financial and referenced records **restrict**: products referenced by orders, orders referenced by payments/refunds/fulfillments, imports referenced by royalties. Archive instead of deleting (`status = ARCHIVED`).
- Optional references are `SET NULL` (listing → product/design, royalty → listing).

## Migrations

Never use `prisma db push` in production.

```bash
# Development: edit schema.prisma, then
pnpm db:migrate --name describe_change      # creates + applies a migration
# Production (compose `migrate` service does this on every deploy)
pnpm db:deploy
```

Commit every migration directory. Review generated SQL for destructive statements before merging.

## Backups

`infrastructure/postgres/backup.sh` (custom-format `pg_dump`, keeps 14) and `restore.sh`. See [DEPLOYMENT.md](DEPLOYMENT.md#backups).
