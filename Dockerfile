# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
# app/ depends on the "algorithmator" workspace package (packages/algorithmator), so this
# stage needs the repo-root pnpm workspace, not just app/ in isolation.
FROM node:22-alpine AS frontend-build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY app/package.json ./app/package.json
COPY packages/algorithmator/package.json ./packages/algorithmator/package.json
RUN pnpm install --frozen-lockfile --filter ocp-simulator...
COPY app/ ./app/
COPY packages/algorithmator/ ./packages/algorithmator/
RUN pnpm --filter algorithmator build
RUN pnpm --filter ocp-simulator build

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
# fontconfig + dejavu: without a font installed, sharp's SVG rasterizer (used by the
# dynamic /api/og image) renders titles as blank space on Alpine.
RUN apk add --no-cache fontconfig ttf-dejavu
RUN npm install -g pm2

COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /repo/app/dist/ocp-simulator /app/frontend
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
