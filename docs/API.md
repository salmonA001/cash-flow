# API reference

Base URL: `https://<API_DOMAIN>/api/v1` (plus `/health`; `/metrics` is internal only). The web app calls it cross-origin with `credentials: 'include'`; CORS allows only `APP_URL`.

## Conventions

- **Auth**: `POST /auth/login` sets two httpOnly, `SameSite=Strict` cookies — `cfe_at` (15-minute JWT) and `cfe_rt` (14-day refresh token, path `/api/v1/auth`, rotated on every use; reuse of a rotated token revokes all of the user's sessions).
- **CSRF**: non-GET requests must carry an `Origin` (or `Referer`) equal to `APP_URL`. Webhooks are exempt and authenticated by signature.
- **Authorization**: each route requires a permission (see `packages/business-rules/src/permissions.ts`). Missing → 403. Other organizations' records → 404.
- **Validation**: bodies and queries are validated with the shared Zod schemas in `packages/validation`.
- **Pagination**: `?page=1&pageSize=25&q=search&sort=field&order=desc` → `{ items, total, page, pageSize }`. Sort fields are whitelisted per endpoint.
- **Errors**: `{ statusCode, error, message, details? }`. 400 validation (`details` lists `{ path, message }`), 401, 403, 404, 409 conflict/duplicate/illegal state, 410 dead download link, 422 missing exchange rate, 429 rate limited.
- **Money**: decimal strings (`"24.99"`), always with a `currency`.
- **Rate limits**: 300 req/min/IP globally; login 5/min; download links 10/min.

## Endpoints

| Method & path | Permission | Notes |
| --- | --- | --- |
| `POST /auth/login` · `/auth/refresh` · `/auth/logout` | public | |
| `GET /auth/me` | session | user + permissions |
| `GET /organization` · `PATCH /organization` | — · settings:write | name, base currency, demo mode, approval requirement |
| `GET /users` · `POST /users` · `PATCH /users/:id` · `GET /roles` | users:write | deactivation revokes sessions |
| `GET /designs` · `POST /designs` | designs:read · designs:write | filters: `status`, `collectionId`, `q` (title/tag) |
| `GET /designs/:id` · `PATCH /designs/:id` | designs:read · designs:write | setting `APPROVED` also needs designs:approve |
| `POST /designs/:id/assets` | designs:write | multipart `file`, `kind`, `newVersion`, `notes` |
| `GET /assets/:id/url` | designs:read | 5-minute presigned URL |
| `GET /collections` · `POST /collections` | designs:read · designs:write | |
| `GET /products` · `POST /products` | products:read · products:write | POD products with variants |
| `GET /products/:id` · `PATCH /products/:id` | | |
| `POST /products/:id/variants` · `PATCH /products/:id/variants/:variantId` | products:write | Printful variant, print file, Shopify variant mapping |
| `GET /listings` · `POST /listings` · `PATCH /listings/:id` | products:* | design must be APPROVED; Amazon listings back-fill royalties |
| `GET /orders` · `GET /orders/:id` | orders:read | filters: `paymentStatus`, `itemType`, `q` |
| `PATCH /orders/:id` | orders:write | `{ itemMappings: [{ orderItemId, variantId }] }` → reclassify + re-run workflow |
| `GET /customers` · `GET /customers/:id` | orders:read | |
| `GET /fulfillment` | fulfillment:read | includes `statusCounts` |
| `POST /fulfillment/:id/submit` · `/retry` | fulfillment:approve | body `{ "confirm": true }`; blocked in demo mode; 202 |
| `GET /digital-products` · `POST /digital-products` · `GET /digital-products/:id` | digital:* | |
| `POST /digital-products/:id/files` | digital:write | new file version |
| `POST /downloads/:digitalProductId/grant` | digital:write | `{ orderItemId }`; order must be PAID; 202, link emailed |
| `POST /downloads/:entitlementId/revoke` | digital:write | `{ reason }` |
| `GET /downloads/access/:token` | public (token) | 302 to a 60-second presigned URL, or 410 |
| `POST /amazon-merch/reports/preview` | amazon:write | multipart CSV, nothing stored |
| `POST /amazon-merch/reports/import` | amazon:write | 202; 409 if the identical file was imported |
| `GET /amazon-merch/imports` · `/royalties` · `/royalties/summary` · `/payouts` | amazon:read | |
| `GET /finance/summary` · `/revenue` · `/profitability` | finance:read | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: last 12 months) |
| `GET /finance/expenses` · `POST /finance/expenses` | finance:read · finance:write | |
| `GET /finance/payouts` · `POST /finance/payouts` | finance:* | |
| `GET /finance/exchange-rates` · `POST /finance/exchange-rates` | finance:* | |
| `GET /analytics/designs` · `/analytics/products` | analytics:read | per currency |
| `GET /automation/rules` · `POST /automation/rules` · `PATCH /automation/rules/:id` | automation:* | core rules cannot be disabled |
| `GET /automation/runs` · `POST /automation/runs/:id/retry` | automation:* | live fulfillment retries go through `/fulfillment` |
| `GET /integrations` · `POST /integrations/:provider/disconnect` | settings / integrations:write | |
| `POST /integrations/shopify/connect` | integrations:write | `{ shop }` → `{ installUrl }` |
| `GET /integrations/shopify/callback` | public (Shopify HMAC + signed state) | |
| `GET /integrations/shopify/status` · `/printful/status` | settings:write | |
| `POST /integrations/printful/connect` | integrations:write | `{ apiToken, storeId }`, validated before storing |
| `POST /webhooks/shopify` | HMAC | `X-Shopify-Hmac-Sha256` over the raw body |
| `POST /webhooks/printful?token=…` | shared secret | |
| `GET /notifications` · `POST /notifications/:id/read` | session | |
| `GET /review-tasks` · `POST /review-tasks/:id/resolve` | session | |
| `GET /audit-logs` | audit:read | |
| `GET /health` | public | 200 / 503 with per-dependency checks |
