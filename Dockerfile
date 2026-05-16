# Stage 1: Build
FROM node:22-bookworm-slim AS build

# pnpm + native build tools (better-sqlite3 needs python3/make/g++)
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && \
    apt-get update && apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: workspace metadata — cached unless deps change
COPY pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json package.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/tools/package.json packages/tools/
COPY packages/observability/package.json packages/observability/
COPY packages/core/package.json packages/core/
COPY packages/plugins/package.json packages/plugins/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile

# Layer 2: source code + build
COPY . .
RUN pnpm build

# Stage 2: Runtime
FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Prod-only install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/tools/package.json packages/tools/
COPY packages/observability/package.json packages/observability/
COPY packages/core/package.json packages/core/
COPY packages/plugins/package.json packages/plugins/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output
COPY --from=build /app/packages/sdk/dist packages/sdk/dist
COPY --from=build /app/packages/tools/dist packages/tools/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/plugins/dist packages/plugins/dist
COPY --from=build /app/packages/server/dist packages/server/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

ENTRYPOINT ["node", "packages/server/dist/bin.js"]
CMD ["serve"]
