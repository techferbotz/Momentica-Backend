# ---- builder -------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app

# Prisma's engines need OpenSSL; the slim image does not ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Drop dev dependencies from the tree we are about to copy across.
RUN npm prune --omit=dev

# ---- runner --------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# node:22-slim ships an unprivileged `node` user; use it.
USER node

EXPOSE 3000
CMD ["node", "dist/app.js"]
