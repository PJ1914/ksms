# syntax=docker/dockerfile:1
# API image (FIXES F18): multi-stage, production dependencies only, non-root, health-checked.
# Migrations are NOT run here; they run from CI with the DIRECT url (docs/database/MIGRATIONS.md).

# ---- build: API + shared packages only (the mobile app's dependencies are never installed)
FROM node:24-slim AS build
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@ksms/api..." \
 && pnpm -r --filter "./packages/*" build \
 && pnpm --filter @ksms/api build

# ---- prod-deps: the same install without devDependencies
FROM node:24-slim AS prod-deps
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@ksms/api..." \
 && mkdir -p apps/api/node_modules

# ---- runtime
FROM node:24-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# Root node_modules (hoisted) + the API's own, then the built code. Workspace packages are linked from
# node_modules/@ksms/* to packages/*, so their package.json and dist come along at the same paths.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/constants/package.json ./packages/constants/package.json
COPY --from=build /app/packages/constants/dist ./packages/constants/dist
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/packages/validation/package.json ./packages/validation/package.json
COPY --from=build /app/packages/validation/dist ./packages/validation/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
