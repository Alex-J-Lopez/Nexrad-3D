FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/radar-parser/package.json packages/radar-parser/
COPY services/ingest-worker/package.json services/ingest-worker/
RUN npm ci --workspace=@nexrad-3d/ingest-worker --include-workspace-root

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @nexrad-3d/contracts
RUN npm run build -w @nexrad-3d/radar-parser
RUN npm run build -w @nexrad-3d/ingest-worker

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/radar-parser/package.json ./packages/radar-parser/package.json
COPY --from=builder /app/packages/radar-parser/dist ./packages/radar-parser/dist
COPY --from=builder /app/services/ingest-worker/package.json ./services/ingest-worker/package.json
COPY --from=builder /app/services/ingest-worker/dist ./services/ingest-worker/dist

CMD ["node", "services/ingest-worker/dist/index.js"]
