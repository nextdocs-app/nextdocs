FROM node:26.4.0-alpine AS base

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
ENV NODE_ENV production

ENV NEXT_TELEMETRY_DISABLED 1

# We create a non-root user for security.
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/web/public ./public

# We need to ensure the non-root user has permissions for the prerender cache.
RUN mkdir .next
RUN chown nextjs:nodejs .next

# We copy the standalone build to reduce image size.
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
# We set the hostname to listen on all interfaces.
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
