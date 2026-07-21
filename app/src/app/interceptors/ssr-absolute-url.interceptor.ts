import { HttpInterceptorFn } from '@angular/common/http';
import { REQUEST } from '@angular/core';
import { inject } from '@angular/core';

/**
 * Angular's HttpClient (withFetch) requires absolute URLs when running on the
 * server, but the app calls relative /api/... paths (nginx proxies those in
 * the browser). REQUEST is only non-null while handling a real SSR request,
 * so this is a no-op during prerendering/build and in the browser.
 */
export const ssrAbsoluteUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const request = inject(REQUEST);
  if (!request || !req.url.startsWith('/')) return next(req);

  const origin = new URL(request.url).origin;
  return next(req.clone({ url: `${origin}${req.url}` }));
};
