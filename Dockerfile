# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
# app/ depends on the "algorithmator" workspace package (packages/algorithmator), so this
# stage needs the repo-root pnpm workspace, not just app/ in isolation.
FROM node:24-alpine AS frontend-build
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
FROM node:24-alpine AS backend-build
WORKDIR /app
ENV PNPM_CONFIG_CONFIRM_MODULES_PURGE=false
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY backend/package.json backend/pnpm-lock.yaml backend/.npmrc backend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY backend/ ./
RUN pnpm run build
# The api stage copies node_modules as-is, so drop the compiler/test/lint toolchain first.
RUN pnpm prune --prod

# ─── Runtime images ───────────────────────────────────────────────────────────
# One target per service (see .ci/stack.yml): `api` (Nest), `ssr` (Angular server) and `web`
# (nginx in front of both, plus the static browser assets and raw markdown). Build each with
# `--target`; the Node ones run under tini so `docker stop` reaches node (a PID 1 without a
# signal handler would ignore SIGTERM and wait out the kill timeout).

FROM node:24-alpine AS api
WORKDIR /app
# Secure by default: dev-only endpoints (dev-login, _test/login) stay disabled unless
# an environment (docker-compose.yml) explicitly overrides this to "development".
ENV NODE_ENV=production
# fontconfig + dejavu: without a font installed, sharp's SVG rasterizer (used by the
# dynamic /api/og image) renders titles as blank space on Alpine.
RUN apk add --no-cache tini fontconfig ttf-dejavu
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

FROM node:24-alpine AS ssr
WORKDIR /app
ENV NODE_ENV=production PORT=4000
RUN apk add --no-cache tini
COPY --from=frontend-build /repo/app/dist/ocp-simulator ./
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/server.mjs"]

FROM nginx:1.29-alpine AS web
# Size nginx workers by the container's CPU limit instead of the host's core count.
ENV NGINX_ENTRYPOINT_WORKER_PROCESSES_AUTOTUNE=1
# Drop the stock welcome page so it can't shadow a route.
RUN mkdir -p /var/cache/nginx/api && rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=frontend-build /repo/app/dist/ocp-simulator/browser /usr/share/nginx/html
COPY backend/src/seed/data /public/content
RUN chmod -R a+rX /public/content /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
