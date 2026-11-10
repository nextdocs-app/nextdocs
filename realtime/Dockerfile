FROM node:24-slim AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
# npm ci runs the root prepare script even when the root workspace is excluded,
# and husky is a devDependency this stage does not install. Remove only that
# script; dependency lifecycle scripts still have to run.
RUN npm pkg delete scripts.prepare
RUN npm ci --workspace realtime --include-workspace-root=false

FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY realtime/ ./realtime/
WORKDIR /app/realtime
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
# The root prepare script installs git hooks and needs dev-only tooling this stage
# omits. Remove it from the manifest instead of turning lifecycle scripts off:
# @y/hub's own install scripts still have to run.
RUN npm pkg delete scripts.prepare
RUN npm ci --omit=dev --workspace realtime --include-workspace-root=false
WORKDIR /app/realtime
COPY --from=builder /app/realtime/dist ./dist
# The same advisory-locked initializer compose runs, so several replicas starting
# together cannot race CREATE DATABASE. Yhub does no DDL on boot; its schema script
# is idempotent and applies after the database exists.
COPY realtime/scripts/init-yhub-db.mjs ./init-yhub-db.mjs
EXPOSE 1234
# SIGTERM has to reach node for the drain handler in dist/main.js to run: `sh`
# does not forward it, so `exec` replaces the shell with the server as PID 1.
CMD ["sh", "-c", "node ./init-yhub-db.mjs && exec node dist/main.js"]
# Nothing in the runtime image needs to write, so it does not run as root.
USER node
