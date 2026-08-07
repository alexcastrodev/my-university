# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY app/ ./
RUN pnpm install --frozen-lockfile
RUN pnpm run build

# ─── Stage 2: Build Backend ───────────────────────────────────────────────────
FROM node:22-alpine AS backend-build
WORKDIR /app
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY backend/package.json backend/pnpm-lock.yaml backend/.npmrc backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY backend/ ./
RUN pnpm run build

# ─── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Secure by default: dev-only endpoints (dev-login, _test/login) stay disabled unless
# an environment (docker-compose.yml) explicitly overrides this to "development".
ENV NODE_ENV=production

RUN apk add --no-cache nginx curl
RUN npm install -g pm2

COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/dist/ocp-simulator /app/frontend
COPY backend/src/seed/data /public/content
RUN chmod -R a+rX /public/content
COPY nginx.conf /etc/nginx/http.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:80/api/health || exit 1

CMD ["sh", "-c", "\
  set -e; \
  pm2 start dist/main.js --name backend --max-restarts=10; \
  PORT=4000 pm2 start frontend/server/server.mjs --name ssr --max-restarts=10; \
  pm2 logs --raw & \
  nginx -g 'daemon off;' \
"]
