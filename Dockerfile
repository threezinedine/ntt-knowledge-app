# syntax=docker/dockerfile:1
# One image = the hub (sync server) + the built web app on a single port.
# Node 24 is required for the built-in node:sqlite module (no native builds needed).

FROM node:24-slim AS base
WORKDIR /app

# Manifests first so dependency layers are cached across source changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# ---- build the web UI ----
FROM manifests AS build
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN npm run build -w @km/web

# ---- runtime: server deps only ----
FROM manifests AS runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --no-audit --no-fund -w @km/server -w @km/core -w @km/engine \
  && npm cache clean --force
COPY packages/core packages/core
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /data && chown node:node /data
VOLUME /data

ENV KM_HOST=0.0.0.0 \
    KM_PORT=4317 \
    KM_DB_PATH=/data/km.sqlite \
    KM_STATIC_DIR=/app/apps/web/dist

USER node
EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
