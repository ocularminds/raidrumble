FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.20.0

COPY . .
# Build native SQLite for the target Linux image, never reuse a developer's native modules.
RUN npm_config_build_from_source=true pnpm install --frozen-lockfile
RUN pnpm build
RUN node -e "const Database = require('./packages/ledger/node_modules/better-sqlite3'); new Database(':memory:').close()"

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/policy ./policy
COPY --from=build --chown=node:node /app/apps/server ./apps/server
COPY --from=build --chown=node:node /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build --chown=node:node /app/apps/overlay/dist ./apps/overlay/dist

RUN mkdir -p /app/data && chown node:node /app/data
USER node
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/main.ts"]
