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
# Apply reviewed, versioned migrations before starting. Schema drift and unsafe
# destructive changes now fail the deployment instead of being forced at boot.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
