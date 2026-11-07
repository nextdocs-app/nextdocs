FROM node:24-slim AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
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
RUN npm ci --omit=dev --workspace realtime --include-workspace-root=false
WORKDIR /app/realtime
COPY --from=builder /app/realtime/dist ./dist
EXPOSE 1234
# Yhub is the only component that runs DDL, and it never does so implicitly on
# boot. Initialise the schema first; the script is CREATE/ALTER ... IF NOT EXISTS,
# so every replica can run it safely.
CMD ["sh", "-c", "node /app/node_modules/@y/hub/bin/init-db.js && npm start"]
