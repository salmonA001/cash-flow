# Security

## Authentication & sessions

- Passwords: **Argon2id** (`argon2` defaults: 64 MiB, t=3). Unknown emails still run one Argon2 verification so timing doesn't reveal which accounts exist.
- Access token: 15-minute HS256 JWT in an httpOnly, `SameSite=Strict`, `Secure` (production) cookie. Algorithm pinned on verify.
- Refresh token: 256-bit random, stored as SHA-256 only, 14-day expiry, path-scoped to `/api/v1/auth`, **rotated on every use**; presenting an already-rotated token revokes every session of that user (theft detection).
- Deactivating a user revokes their sessions. Every request re-loads the user and role, so permission changes apply immediately.

## Authorization

- Role-based permissions (`packages/business-rules/src/permissions.ts`), enforced by a global guard per route.
- Organization isolation in every query; cross-organization access returns 404.
- Judgment actions have their own permissions: `designs:approve` (IP/copyright), `fulfillment:approve` (live billable orders).

## Request protection

- CSRF: `SameSite=Strict` cookies **and** an Origin check on every state-changing request.
- CORS: credentialed requests are allowed from exactly one origin, `APP_URL`. In production Caddy serves the web app and the API on that one origin, so session cookies are host-only and first-party; CORS only matters for local development (web on :3000, API on :4000).
- Rate limiting: global, plus tight limits on login and download links.
- Security headers: `helmet` on the API (cross-origin resource policy `same-site`), HSTS and `nosniff` at Caddy, and HSTS / `nosniff` / `DENY` framing / referrer and permissions policies from `next.config.ts` for the web app.
- Strict input validation with Zod; Prisma parameterizes all SQL (raw analytics queries use tagged templates).
- Errors never include stack traces or internals; 5xx details are logged server-side only.

## Webhooks

- Shopify: HMAC-SHA256 over the raw body, constant-time compare; delivery ID dedupe.
- Printful: shared-secret token in the URL, constant-time compare (v1 webhooks are unsigned) — and state is re-fetched from the API, so a forged webhook can at most trigger a re-sync.
- Unknown accounts are acknowledged and ignored.

## Secrets

- Only in `.env` (git-ignored). `.env.example` contains placeholders only. The API and worker refuse to start with missing or weak configuration.
- Integration tokens are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`) and never returned by the API.
- MinIO: separate root (admin) and application credentials; the app user only has object access on its buckets. The console is never exposed.

## Files

- Uploads: size limits, MIME allow-list, extension match, magic-byte check, SVG active-content rejection, SHA-256 checksum recorded and stored size verified.
- All buckets are private. Browsers get presigned URLs only: 5 minutes for previews, 60 seconds for downloads, 1 hour for Printful print files.
- Object keys are structured and sanitized: `{org}/{entity}/{id}/{timestamp}-{name}`.

## Digital downloads

- Payment verified server-side from the stored order (never from a browser redirect), again in the worker before granting.
- Tokens: 256-bit random, only the SHA-256 hash is stored, raw token delivered once by email.
- Each download consumes the count with a conditional update, so concurrent requests cannot exceed the limit. Revocation and expiry are checked first; every attempt is logged.
- A full refund revokes access automatically.

## Safe automation

- Demo mode blocks live external actions.
- Live fulfillment is never retried automatically; timeouts are treated as unknown outcomes.
- Every automation and every mutation is recorded (`AutomationRun`, `AuditLog`).

## Operational checklist

- [ ] Strong unique values for every secret in `.env`; back up `ENCRYPTION_KEY` separately (losing it means reconnecting integrations).
- [ ] `COOKIE_SECURE=true` and HTTPS in production.
- [ ] Firewall: only 80/443 open (plus SSH).
- [ ] Nightly `backup.sh` + off-site copy; MinIO mirrored.
- [ ] Keep demo mode on until a staging order has gone through end to end.
