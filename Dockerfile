# Production Dockerfile for ZeroID (Identity).
#
# @aethelred/sdk is not published to a registry yet. The lockfile intentionally
# consumes it as a sibling workspace package, so this image fetches an immutable
# protocol commit, verifies the checkout, and builds that SDK before installing
# ZeroID. Operators may move the pin only after compatibility CI passes.

ARG AETHELRED_REF=20d6060adc91860736f4ba619fe29cbda54b2cf7

# Stage 1: Canonical protocol SDK
FROM node:20.19.5-alpine3.22 AS protocol
ARG AETHELRED_REF
RUN apk add --no-cache git
WORKDIR /workspace
RUN git init aethelred \
  && cd aethelred \
  && git remote add origin https://github.com/aethelred-foundation/aethelred.git \
  && git fetch --depth=1 origin "${AETHELRED_REF}" \
  && git checkout --detach FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "${AETHELRED_REF}"
WORKDIR /workspace/aethelred/sdk/typescript
RUN npm ci --no-fund \
  && npm run build

# Stage 2: Dependencies
FROM node:20.19.5-alpine3.22 AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /workspace/zeroid
COPY --from=protocol /workspace/aethelred/sdk/typescript /workspace/aethelred/sdk/typescript
COPY package.json package-lock.json ./
RUN npm ci --no-fund

# Stage 3: Build
FROM node:20.19.5-alpine3.22 AS builder
WORKDIR /workspace/zeroid
COPY --from=deps /workspace/aethelred/sdk/typescript /workspace/aethelred/sdk/typescript
COPY --from=deps /workspace/zeroid/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 4: Production
FROM node:20.19.5-alpine3.22 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /workspace/zeroid/public ./public
COPY --from=builder --chown=nextjs:nodejs /workspace/zeroid/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /workspace/zeroid/.next/static ./.next/static
# Copy the lockfile-resolved image optimizer packages from the dependency stage.
COPY --from=deps --chown=nextjs:nodejs /workspace/zeroid/node_modules/sharp ./node_modules/sharp
COPY --from=deps --chown=nextjs:nodejs /workspace/zeroid/node_modules/@img ./node_modules/@img
USER nextjs
EXPOSE 3003
ENV PORT=3003
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
