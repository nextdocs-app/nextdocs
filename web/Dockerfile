# Keep the Node line in sync with .nvmrc; `npm run check:runtime-versions` fails otherwise.
FROM node:24.14.1-alpine AS base

FROM base AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY realtime/package.json ./realtime/package.json
RUN npm ci --workspace web --include-workspace-root=false --ignore-scripts

FROM base AS builder
WORKDIR /app
# We copy the base config to the root directory to support the build process.
COPY --from=deps /app/ ./
COPY tsconfig.base.json /app/tsconfig.base.json
COPY web/ /app/web/
COPY realtime/src/types/ /app/realtime/src/types/

WORKDIR /app/web

RUN npm run build

FROM base AS runner
WORKDIR /app/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# We create a non-root user for security.
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Next writes the monorepo standalone output as ./web/server.js because the
# workspace root is /app. Keep that layout so server.js can resolve the hoisted
# node_modules at /app/web/node_modules.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

# Next needs a writable cache directory; everything else can stay read-only.
RUN mkdir -p web/.next/cache && chown -R nextjs:nodejs web

USER nextjs

EXPOSE 3000

ENV PORT=3000
# We set the hostname to listen on all interfaces.
ENV HOSTNAME=0.0.0.0

CMD ["node", "web/server.js"]
