# syntax=docker/dockerfile:1.7
# One Dockerfile, three runtime targets: backend (api / worker / scheduler / migrate) and web.

FROM node:22.21.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
# Rewrites in next.config are resolved at build time.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
RUN pnpm -r run build

# ── API, worker, scheduler and migrations share this image (different commands). ──
FROM base AS backend
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ── Next.js standalone server ──
FROM node:22.21.0-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
