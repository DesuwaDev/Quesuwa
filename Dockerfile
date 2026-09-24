# syntax=docker/dockerfile:1.7

# ---- Build the frontend (runs the i18n gate via prebuild) ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}
RUN npm run build

# ---- Production dependencies only ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && find node_modules -type f \( -name '*.md' -o -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.ts.map' \) -delete \
 && find node_modules -type d \( -name test -o -name tests -o -name docs -o -name example -o -name examples \) -prune -exec rm -rf {} +

# ---- Runtime ----
FROM node:24-alpine
# The app never runs npm at runtime; dropping the package managers saves ~20 MB and attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /app/data && chown node:node /app/data
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
# busybox wget is already in Alpine; much lighter than starting a second Node process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -T 4 -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server/index.js"]
