FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/llm/package.json ./packages/llm/
COPY packages/agents/package.json ./packages/agents/
COPY packages/memory/package.json ./packages/memory/
COPY packages/storage/package.json ./packages/storage/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/server/package.json ./packages/server/

RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build --filter @agentforge/server

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/llm/dist ./packages/llm/dist
COPY --from=builder /app/packages/agents/dist ./packages/agents/dist
COPY --from=builder /app/packages/memory/dist ./packages/memory/dist
COPY --from=builder /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
