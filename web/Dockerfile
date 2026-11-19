# Keep the Node line in sync with .nvmrc; `pnpm run check:runtime-versions` fails otherwise.
FROM node:24.14.1-alpine AS base
RUN npm install -g pnpm@12.21.0

FROM base AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json ./web/package.json
COPY realtime/package.json ./realtime/package.json
RUN pnpm install --frozen-lockfile --filter web

FROM base AS builder
WORKDIR /app
# We copy the base config to the root directory to support the build process.
COPY --from=deps /app/ ./
COPY tsconfig.base.json /app/tsconfig.base.json
COPY web/ /app/web/
COPY realtime/src/types/ /app/realtime/src/types/

WORKDIR /app/web

RUN pnpm run build

# The standalone server does not use pnpm, so skip the global install from base.
FROM node:24.14.1-alpine AS runner
WORKDIR /app/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# We create a non-root user for security.
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Next writes the monorepo standalone output as ./web/server.js because the
# workspace root is /app. The standalone folder carries the traced node_modules
# it needs, so the image does not depend on the install layout.
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
