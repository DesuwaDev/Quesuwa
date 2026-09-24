# syntax=docker/dockerfile:1.7

# Keep both on the same Alpine release: the runtime reuses the node binary,
# which links against that release's musl and libstdc++.
ARG NODE_IMAGE=node:24-alpine3.24
ARG ALPINE_IMAGE=alpine:3.24

# ---- Build the frontend (runs the i18n gate via prebuild) ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}
RUN npm run build

# ---- Production dependencies only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && find node_modules -type f \( -name '*.md' -o -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete \
 && find node_modules -type d \( -name test -o -name tests -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} +

FROM ${NODE_IMAGE} AS node

# ---- Runtime: plain Alpine plus the node binary ----
# Deleting npm/yarn in a layer on top of node:alpine would not shrink the image,
# so the runtime starts from Alpine and copies only what it needs.
FROM ${ALPINE_IMAGE}
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node \
 && mkdir -p /app/data && chown node:node /app/data
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ARG APP_VERSION=
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 DATA_DIR=/app/data APP_VERSION=${APP_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY i18n/core.js i18n/legacy-statuses.json ./i18n/
COPY i18n/locales ./i18n/locales
COPY scripts/reset-password.js ./scripts/reset-password.js
LABEL org.opencontainers.image.title="Quesuwa" \
      org.opencontainers.image.description="Self-hosted questionnaires and anonymous feedback" \
      org.opencontainers.image.version="${APP_VERSION}"
USER node
VOLUME ["/app/data"]
EXPOSE 3100
# busybox wget ships with Alpine; much lighter than starting a second Node process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -T 4 -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server/index.js"]
