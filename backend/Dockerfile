FROM node:22-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ─── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache python3 make g++ sqlite

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Rebuild native bindings inside the final image
RUN cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 \
    && npx node-pre-gyp install --fallback-to-build 2>&1 || \
    node_modules/.bin/node-pre-gyp install --fallback-to-build 2>&1 || true

COPY --from=builder /app/dist ./dist

VOLUME ["/app/data"]
ENV DB_PATH=/app/data/ocp-java.db

EXPOSE 3000
CMD ["node", "dist/main.js"]
