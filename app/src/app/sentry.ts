import type { Injector } from '@angular/core';

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
    void loadSdk().then((Sentry) => injector.get(Sentry.TraceService));
  });
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
