// The only Sentry pieces the app uses, in their own module so the lazy chunk holds just these
// instead of the whole SDK (session replay, feedback widget...) that `import('@sentry/angular')`
// would pull in. Loaded on demand by sentry.ts; nothing else imports it.
export {
  TraceService,
  browserTracingIntegration,
  captureException,
  getActiveSpan,
  getRootSpan,
  init,
  spanToJSON,
} from '@sentry/angular';

/**
 * The deployed commit, injected at build time (`ng build --define`, see Dockerfile). Kept in this
 * lazy chunk so a new commit doesn't change main.js's hash. Absent in local builds, in which case
 * events simply carry no release.
 */
declare const SENTRY_RELEASE: string | undefined;
export const RELEASE =
  typeof SENTRY_RELEASE === 'string' && SENTRY_RELEASE ? SENTRY_RELEASE : undefined;
