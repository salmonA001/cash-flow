# Integrations

All provider code lives in `packages/integration-sdk`. Credentials are stored per organization in `IntegrationCredential`, encrypted with AES-256-GCM (`ENCRYPTION_KEY`), and decrypted only inside the worker/API process that uses them.

## Shopify (GraphQL Admin API)

**Setup**

1. In the Shopify Partner dashboard (or the store's *Develop apps*), create an app.
2. App URL: `https://<APP_DOMAIN>`. Allowed redirection URL: `https://<APP_DOMAIN>/api/v1/integrations/shopify/callback`.
3. Put the client ID / secret in `.env` (`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`).
4. In the app: **Settings → Integrations → Shopify**, enter `your-store.myshopify.com`, approve the scopes.

Scopes: `read_orders, read_products, read_customers, read_fulfillments`.

**What happens on connect**: Shopify's callback HMAC and our signed, 10-minute `state` are verified; the code is exchanged for an offline token; webhooks are registered for `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`, `products/update`, `app/uninstalled`.

**Webhooks**: verified with HMAC-SHA256 over the raw body using the client secret, deduplicated by `X-Shopify-Webhook-Id`, then processed by re-fetching the order through GraphQL. `products/update` is acknowledged and recorded but not applied: the catalog is managed in this system (Stage 2 adds pull sync). `app/uninstalled` disconnects the integration and raises a critical notification.

**Rate limits**: GraphQL `THROTTLED` responses wait for the cost bucket to refill (using the returned `throttleStatus`) and retry, up to 5 times.

**Reconciliation**: hourly, every order updated in the last 26 hours is re-synced — this repairs missed webhooks.

### Upgrading the Shopify API version

The version is pinned in `packages/integration-sdk/src/shopify/version.ts` (`SHOPIFY_API_VERSION`). Shopify releases quarterly and supports each version for 12 months.

1. Read the release notes for every version between the current and target one; check `Order`, `OrderTransaction`, `Refund`, `webhookSubscriptionCreate`.
2. Change the constant; update `ORDER_QUERY` / types in `shopify/client.ts` and `order-mapper.ts` if fields changed.
3. `pnpm --filter @cfe/integration-sdk test`, then sync one real order on a development store.
4. Deploy. Webhook subscriptions keep their own API version; re-run **Connect** to re-register them on the new version.

## Printful

**Setup**: create a private token in Printful (Developer portal) with order permissions and note the store ID. **Settings → Integrations → Printful**: paste token + store ID. The token is validated with a read-only catalog request before it's stored.

**Webhooks**: Printful API v1 webhooks are not signed, so the webhook URL carries a shared secret: configure `https://<APP_DOMAIN>/api/v1/webhooks/printful?token=<PRINTFUL_WEBHOOK_SECRET>` for `package_shipped`, `order_failed`, `order_canceled`, `order_updated`, `order_put_hold`. The token is compared in constant time, and the order status is always **re-fetched from the Printful API** — webhook content is only used to find the order. If you migrate to Printful API v2 webhooks (signed), replace the token check in `apps/api/src/webhooks/webhooks.service.ts` with signature verification.

**Submission safeguards** (`apps/worker/src/processors/fulfillment-submit.ts`):

- Approval required (`fulfillment:approve`) and an explicit `{ confirm: true }`; blocked entirely while **demo mode** is on.
- Eligibility re-checked: paid, open, valid address, every POD item mapped to a Printful variant with a print file.
- Idempotency key `"<orderId>:printful"` is sent as Printful's `external_id`. Before creating anything the worker looks up `@<external_id>`; an existing order is adopted, never duplicated.
- Draft → confirm. A timeout marks `NEEDS_REVIEW` (outcome unknown) and opens a review task. Nothing is retried automatically; a manual retry is safe because of the lookup.
- Print files are passed as one-hour presigned URLs.

The `FulfillmentProvider` interface (`integration-sdk/src/fulfillment-provider.ts`) isolates Printful; another POD provider is a new adapter plus a `FulfillmentProviderKey` enum value.

**Reconciliation**: every 30 minutes, submitted / in-production orders are refreshed from Printful.

## Amazon Merch on Demand

Merch on Demand has no supported API for royalties, and Seller Central SP-API does not cover Merch data. This system **only imports CSV reports you export yourself**. It never scrapes pages or automates the Merch website.

**Formats** are declared in `packages/business-rules/src/amazon-merch/report-formats.ts` as header → field mappings. The parser detects the format from the header row. Two layouts ship (`merch-royalties-v1` with a currency column, `merch-sales-v1` deriving currency from the marketplace). **Check them against a real export from your dashboard**; if Amazon changes column names, add a new format entry — the royalty model and import pipeline don't change.

Each row is validated (date, 10-character ASIN, marketplace, royalty amount, unit counts, currency), normalized and hashed; the hash makes re-imports and overlapping reports idempotent. Rows that fail validation are reported by row number and field and are not imported.

## Email (download links)

The worker sends download links over SMTP (`SMTP_URL`, `MAIL_FROM`). The raw token exists only in that email; if delivery fails, the retry rotates the token and sends a new link.
