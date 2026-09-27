// The only Sentry pieces the app uses, in their own module so the lazy chunk holds just these
// instead of the whole SDK (session replay, feedback widget...) that `import('@sentry/angular')`
// would pull in. Loaded on demand by sentry.ts; nothing else imports it.
export {
  TraceService,
  browserTracingIntegration,
  captureException,
  init,
} from '@sentry/angular';
