import { HttpInterceptorFn } from '@angular/common/http';
import { REQUEST } from '@angular/core';
import { inject } from '@angular/core';

/**
 * Angular's HttpClient (withFetch) requires absolute URLs when running on the
 * server, but the app calls relative /api/... paths (nginx proxies those in
 * the browser). This must also rewrite the URL on the client to the SAME
 * absolute form: the HTTP transfer-cache keys cached SSR responses by request
 * URL, so if only the server rewrote it, the client's relative URL would
 * never match and every SSR'd request would be refetched during hydration.
 */
export const absoluteUrlInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/')) return next(req);

  const request = inject(REQUEST);
  const origin = request ? new URL(request.url).origin : typeof location !== 'undefined' ? location.origin : null;
  if (!origin) return next(req);

  return next(req.clone({ url: `${origin}${req.url}` }));
};
