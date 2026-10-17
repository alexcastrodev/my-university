import { HttpEventType, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { XpService } from '../services/xp.service';

/**
 * Hands the badges and trophies an action just earned (`newAwards` in the response of a lesson or
 * concept completion) to the XP service, which announces them. The explicit sync endpoint is left
 * alone: it backfills quietly. Services are looked up lazily because `XpService` itself uses `HttpClient`.
 */
export const awardsInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);
  const userId = injector.get(AuthService).currentUser()?.id;
  if (req.method !== 'PUT' || userId === undefined) return next(req);
  return next(req).pipe(
    tap((event) => {
      if (event.type !== HttpEventType.Response) return;
      const awards = (event.body as { newAwards?: unknown } | null)?.newAwards;
      if (Array.isArray(awards) && awards.length > 0) injector.get(XpService).receiveAwards(userId, awards);
    }),
  );
};
