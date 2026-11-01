# syntax=docker/dockerfile:1.7
# Backend image: the api, worker, scheduler and migrate services run it with different commands.
# The web app is built and hosted by Vercel, so it is excluded here.

FROM node:22.21.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile --filter '!@cfe/web'
RUN pnpm -r --filter '!@cfe/web' run build

FROM base AS backend
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
