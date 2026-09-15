# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# `output: 'standalone'` produces a self-contained server, plus static assets
# that Next deliberately leaves outside that server directory.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts/migrate-images-webp.mjs /app/scripts/webp-assets.json ./scripts/

RUN mkdir -p /data /app/.next/cache && chown node:node /data /app/.next/cache \
    && chmod 644 /app/public/gutv-logo.png
USER node
EXPOSE 3000
CMD ["node", "server.js"]
