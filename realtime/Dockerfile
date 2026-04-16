FROM node:24.14.1-alpine AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspace realtime --include-workspace-root=false --ignore-scripts

FROM node:24.14.1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY realtime/ ./realtime/
WORKDIR /app/realtime
RUN npm run build

FROM node:24.14.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
COPY package.json package-lock.json ./
COPY realtime/package.json ./realtime/package.json
COPY web/package.json ./web/package.json
RUN npm ci --omit=dev --workspace realtime --include-workspace-root=false --ignore-scripts
WORKDIR /app/realtime
COPY --from=builder /app/realtime/dist ./dist
EXPOSE 1234
CMD ["npm", "start"]
