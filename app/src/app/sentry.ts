import type { Injector } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';

type SentrySdk = typeof import('./sentry-sdk');

const DSN =
  'https://d1d441afb2af51cdb8bee62117de6f90@o4509399654989824.ingest.us.sentry.io/4512158428823552';
const PRODUCTION_HOST = 'university.kurz.fyi';

let sdk: Promise<SentrySdk> | null = null;

/** Only the real site reports, so `ng serve`, previews, tests and the server render stay quiet. */
function enabled(): boolean {
  return typeof location !== 'undefined' && location.hostname === PRODUCTION_HOST;
}

/**
 * Error and performance reporting to Sentry (kutz/university-web).
 *
 * The SDK is about as big as the rest of the initial bundle, so it is not part of it: main.ts
 * calls this once the app has rendered and the browser is idle, and the SDK arrives as its own
 * chunk. The page-load trace still covers the whole load, since it is built from the browser's
 * own timing data. Navigations are named after their route, and /api calls carry the trace
 * headers, so a slow screen links to the university-api trace of the request behind it.
 */
export function startSentry(injector: Injector): void {
  if (!enabled()) return;
  whenIdle(() => {
    void loadSdk().then((Sentry) => {
      injector.get(Sentry.TraceService);
      nameOngoingPageload(Sentry, injector.get(Router));
    });
  });
}

/**
 * TraceService names a pageload on the router's first ResolveEnd, which has long passed by the
 * time the SDK arrives, so without this every pageload is just "Pageload" and Web Vitals can't
 * be split per screen. The pageload span is still open (it waits for the page to go idle), so
 * it is renamed here after the route the user landed on, in the same `/a/:b/` form TraceService
 * gives navigations.
 */
function nameOngoingPageload(Sentry: SentrySdk, router: Router): void {
  const active = Sentry.getActiveSpan();
  if (!active) return;
  const root = Sentry.getRootSpan(active);
  if (Sentry.spanToJSON(root).attributes?.['sentry.op'] !== 'pageload') return;
  root.updateName(parameterizedRoute(router.routerState.snapshot.root));
  root.setAttribute('sentry.source', 'route');
}

function parameterizedRoute(root: ActivatedRouteSnapshot): string {
  const parts: string[] = [];
  for (let route = root.firstChild; route?.routeConfig?.path != null; route = route.firstChild) {
    parts.push(route.routeConfig.path);
  }
  const path = parts.filter(Boolean).join('/');
  return path ? `/${path}/` : '/';
}

/** Sends an error once the SDK is in (loading it if it isn't yet). No-op off the real site. */
export function reportError(error: unknown, level: 'error' | 'warning' = 'error'): void {
  if (!enabled()) return;
  void loadSdk().then((Sentry) => Sentry.captureException(error, { level }));
}

function loadSdk(): Promise<SentrySdk> {
  sdk ??= import('./sentry-sdk').then((Sentry) => {
    Sentry.init({
      dsn: DSN,
      release: Sentry.RELEASE,
      environment: 'production',
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.2,
      tracePropagationTargets: [/^\/api\//, new RegExp(`^https://${PRODUCTION_HOST}/api/`)],
    });
    return Sentry;
  });
  return sdk;
}

function whenIdle(run: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
