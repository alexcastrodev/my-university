import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

/**
 * A `development`-configuration build (e.g. `ng serve`'s default) never sets `localize`, so
 * only the source (`en`) bundle exists — no `pt-BR/` subfolder. Redirecting to `/pt-BR` in
 * that case sends every Portuguese-speaking visitor into a 404 the app can never resolve.
 * Checked once at startup, not per-request: whether the locale bundle exists doesn't change
 * while the server is running.
 */
const hasPtBrBundle = existsSync(join(browserDistFolder, 'pt-BR'));

const app = express();
const angularApp = new AngularNodeAppEngine({ trustProxyHeaders: true });

/**
 * During SSR, `absoluteUrlInterceptor` turns `/api/...` into `<public origin>/api/...` (it has
 * to: the HTTP transfer cache is keyed by that URL, and the browser must compute the same one).
 * Left alone, the SSR container would then call its own public domain, out through the
 * reverse proxy and TLS and back in. When `SSR_API_ORIGIN` is set (the internal nginx, e.g.
 * `http://web`, so renders also hit its content cache), only the actual network call is
 * redirected there; the URL Angular keys the transfer cache by is unchanged, because this sits
 * below HttpClient at the `fetch` level.
 */
const ssrApiOrigin = process.env['SSR_API_ORIGIN'];
if (ssrApiOrigin) {
  const publicFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if ((typeof input === 'string' && URL.canParse(input)) || input instanceof URL) {
      const url = new URL(input);
      if (url.pathname.startsWith('/api/')) {
        return publicFetch(`${ssrApiOrigin}${url.pathname}${url.search}`, init);
      }
    }
    return publicFetch(input, init);
  };
}

/**
 * Tracks, per render, whether any API call it made failed, so a page rendered while the API was
 * down or restarting (which still comes out as a 200 with empty or error content) is never put
 * in the render cache below. Wraps whatever `fetch` is in place, including the redirect above.
 */
const renderOutcome = new AsyncLocalStorage<{ apiFailed: boolean }>();
{
  const innerFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const outcome = renderOutcome.getStore();
    try {
      const response = await innerFetch(input, init);
      if (outcome && !response.ok) outcome.apiFailed = true;
      return response;
    } catch (err) {
      if (outcome) outcome.apiFailed = true;
      throw err;
    }
  };
}

/** Liveness probe for the container healthcheck; cheap on purpose (no Angular render). */
app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * The `en` locale owns the root `/` (its subPath is `''`), so Angular's own Accept-Language
 * redirect never triggers — `/` already matches an entry point. This is the replacement, for
 * first-time visitors only: it never fires once the user has actually navigated, since from then
 * on they're on a URL that already carries the right prefix.
 */
function prefersPortuguese(acceptLanguage: string | undefined): boolean {
  if (!acceptLanguage) return false;
  const top = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, qPart] = part.trim().split(';q=');
      return { tag: tag.trim().toLowerCase(), q: qPart ? parseFloat(qPart) : 1 };
    })
    .sort((a, b) => b.q - a.q)[0]?.tag;
  return top?.startsWith('pt') ?? false;
}

app.use((req, res, next) => {
  if (hasPtBrBundle && req.path === '/' && prefersPortuguese(req.headers['accept-language'])) {
    res.redirect(302, `/pt-BR${req.url}`);
    return;
  }
  next();
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 *
 * The rendered HTML references the current build's hashed chunk filenames, so it must never be
 * cached — a cached page from a previous deploy would point at chunks that no longer exist on
 * the server. The hashed chunks themselves stay cacheable forever (see express.static above);
 * only this per-request document needs `no-store`.
 */
app.use((req, res, next) => {
  const key = renderCacheKey(req);
  const cached = key ? renderCache.get(key) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    void writeResponseToNodeResponse(toResponse(cached, 'HIT', 0), res).catch(next);
    return;
  }

  const startedAt = performance.now();
  const outcome = { apiFailed: false };
  renderOutcome
    .run(outcome, () => angularApp.handle(req))
    .then(async (response) => {
      if (!response) return next();
      const renderMs = performance.now() - startedAt;
      if (!key || response.status !== 200 || outcome.apiFailed) {
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('Server-Timing', `ssr;dur=${renderMs.toFixed(1)}`);
        return writeResponseToNodeResponse(response, res);
      }
      const entry: CachedRender = {
        status: response.status,
        headers: [...response.headers.entries()],
        body: await response.text(),
        expiresAt: Date.now() + RENDER_CACHE_TTL_MS,
      };
      remember(key, entry);
      return writeResponseToNodeResponse(toResponse(entry, 'MISS', renderMs), res);
    })
    .catch(next);
});

/**
 * Short-lived cache of rendered pages. The server render is the same for every visitor: it
 * never forwards the visitor's cookies to the API, so it always renders the signed-out view
 * (the browser fills in the user's state after hydration), and the page depends only on its URL.
 * Rendering is the bulk of the HTML's time to first byte, and most traffic lands on a small set
 * of concept pages, so repeat hits within a few minutes are answered from memory.
 *
 * It lives in this process rather than in nginx on purpose: a cached page names this build's
 * hashed chunks, and this cache is dropped together with the build that rendered it on deploy.
 * Off outside production, so `ng serve` always shows the current code.
 */
interface CachedRender {
  status: number;
  headers: [string, string][];
  body: string;
  expiresAt: number;
}

const RENDER_CACHE_ENABLED = process.env['NODE_ENV'] === 'production';
const RENDER_CACHE_TTL_MS = 5 * 60_000;
/** Bounds memory against crawlers walking every page (and junk query strings). */
const RENDER_CACHE_MAX_ENTRIES = 500;
const renderCache = new Map<string, CachedRender>();

function renderCacheKey(req: express.Request): string | null {
  if (!RENDER_CACHE_ENABLED || req.method !== 'GET') return null;
  // The engine trusts the proxy headers (canonical and OG URLs are built from them), so they key too.
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('x-forwarded-host') ?? req.get('host');
  return `${proto}://${host}${req.originalUrl}`;
}

/** Insertion order doubles as age order, so the oldest entry is the first key. */
function remember(key: string, entry: CachedRender): void {
  renderCache.delete(key);
  renderCache.set(key, entry);
  if (renderCache.size > RENDER_CACHE_MAX_ENTRIES) {
    renderCache.delete(renderCache.keys().next().value!);
  }
}

/**
 * The document itself is still `no-store` for the browser: it names this build's hashed chunks,
 * and a copy kept past a deploy would point at chunks that no longer exist.
 */
function toResponse(entry: CachedRender, cacheStatus: 'HIT' | 'MISS', renderMs: number): Response {
  const headers = new Headers(entry.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Render-Cache', cacheStatus);
  headers.set('Server-Timing', `ssr;dur=${renderMs.toFixed(1)}`);
  return new Response(entry.body, { status: entry.status, headers });
}

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
