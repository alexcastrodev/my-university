import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Sends the session cookie with every request so the server can identify the
 * user. Required for cross-origin dev; harmless same-origin in production.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
