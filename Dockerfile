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

RUN apk add --no-cache nginx

COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/dist/ocp-simulator/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/http.d/default.conf

EXPOSE 80

CMD ["sh", "-c", "node dist/main.js & nginx -g 'daemon off;'"]
