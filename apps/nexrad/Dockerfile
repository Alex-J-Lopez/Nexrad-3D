FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/radar-colors/package.json packages/radar-colors/
COPY packages/radar-parser/package.json packages/radar-parser/
COPY apps/nexrad/package.json apps/nexrad/
RUN npm ci --workspace=@nexrad-3d/nexrad --include-workspace-root

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @nexrad-3d/contracts
RUN npm run build -w @nexrad-3d/radar-parser
RUN npm run build -w @nexrad-3d/radar-colors
RUN npm run build -w @nexrad-3d/nexrad

# Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone server chdir's to apps/nexrad; static assets must live at apps/nexrad/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/nexrad/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/nexrad/.next/static ./apps/nexrad/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/nexrad/server.js"]
