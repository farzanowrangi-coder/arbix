FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/odds-engine ./packages/odds-engine
COPY apps/api ./apps/api

# Install deps
RUN npm install --workspace=packages/shared --workspace=packages/odds-engine --workspace=apps/api

# Build packages in order
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/odds-engine
RUN npm run build --workspace=apps/api

# ─── Runner stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 fastify

WORKDIR /app

COPY --from=builder --chown=fastify:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=fastify:nodejs /app/apps/api/package.json ./
COPY --from=builder --chown=fastify:nodejs /app/node_modules ./node_modules

USER fastify

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
