# ZeroID backend — Express + Prisma(Postgres) + Redis. Node >= 20.
FROM node:20-slim AS build
WORKDIR /app
# Prisma needs openssl at generate/runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 4003
# Sync the schema, then start. The committed migrations are incremental and
# assume a baseline that was created with `db push`, so a fresh testnet DB is
# provisioned with `db push` (creates all 35 models). For production, baseline
# a proper migration set and switch this to `prisma migrate deploy`.
# NODE_ENV is set by compose/.env — keep it non-production for testnet so local
# credential signing is permitted.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
