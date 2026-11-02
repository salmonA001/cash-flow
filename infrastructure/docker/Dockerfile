# syntax=docker/dockerfile:1.7
# Targets:
#   backend — api, worker, scheduler and migrate (different commands, same image)
#   web     — Next.js app (docker-compose.yml behind Caddy, docker-compose.local.yml on localhost)

FROM node:22.21.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps apps

FROM base AS backend-build
RUN pnpm install --frozen-lockfile --filter '!@cfe/web'
RUN pnpm -r --filter '!@cfe/web' run build

FROM base AS backend
ENV NODE_ENV=production
COPY --from=backend-build /app /app
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM base AS web-build
# Inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter '@cfe/web...'
RUN pnpm --filter '@cfe/web...' run build

FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=web-build /app /app
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
