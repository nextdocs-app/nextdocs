# uWS ships a prebuilt binding that requires glibc >= 2.38. Debian bookworm (node:24-slim)
# has 2.36 and the image dies at import; trixie has 2.41. Keep all stages on the same
# libc so the native binding installed in deps matches the runner.
# Keep the Node line in sync with .nvmrc; `pnpm run check:runtime-versions` fails otherwise.
FROM node:26.13.1-trixie-slim AS base
RUN npm install -g pnpm@12.21.0

FROM base AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile --filter realtime

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY realtime/ ./realtime/
WORKDIR /app/realtime
RUN pnpm run build

FROM base AS prod-deps
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile --prod --filter realtime

# The runtime needs the production install, not pnpm or its store: copying only
# /app drops the global pnpm from base and the caches pnpm keeps under /root.
FROM node:26.13.1-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
COPY --from=prod-deps /app/ ./
WORKDIR /app/realtime
COPY --from=builder /app/realtime/dist ./dist
# The same advisory-locked initializer compose runs, so several replicas starting
# together cannot race CREATE DATABASE. Yhub does no DDL on boot; its schema script
# is idempotent and applies after the database exists. The image is the only thing
# a bare `docker run` has, so it must create both the database and the schema.
COPY realtime/scripts/init-yhub-db.mjs ./init-yhub-db.mjs
EXPOSE 1234
# SIGTERM has to reach node for the drain handler in dist/main.js to run: `sh`
# does not forward it, so `exec` replaces the shell with the server as PID 1.
# The two init steps run before that, leaving `sh` as PID 1 for a sub-second
# window in which a stop waits for SIGKILL. Both steps are idempotent and short,
# and the drain path only matters once the server is accepting sockets, so the
# window is accepted rather than adding an init binary to the runtime image.
CMD ["sh", "-c", "node ./init-yhub-db.mjs && node ./node_modules/@y/hub/bin/init-db.js && exec node dist/main.js"]
# Nothing in the runtime image needs to write, so it does not run as root.
# The init steps only read; @y/hub/init-db.js needs no filesystem writes either.
USER node
