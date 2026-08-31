import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({ trustProxyHeaders: true });

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
  if (req.path === '/' && prefersPortuguese(req.headers['accept-language'])) {
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
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) return next();
      response.headers.set('Cache-Control', 'no-store');
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

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
