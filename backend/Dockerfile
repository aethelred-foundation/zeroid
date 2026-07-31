# ZeroID backend — Express + Prisma(Postgres) + Redis. Node >= 20.
FROM node:20.19.5-bookworm-slim AS build
WORKDIR /app
# Prisma needs openssl at generate/runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:20.19.5-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 4003
# The read-only preflight stops P3005 before Prisma touches an untracked
# non-empty schema. Compose runs this command in a one-shot migration service;
# keeping it as the image default also protects direct container runs.
CMD ["sh", "-c", "node dist/ops/database-migration-preflight.js && npx prisma migrate deploy && exec node dist/index.js"]
