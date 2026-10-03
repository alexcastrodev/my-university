import * as Sentry from '@sentry/nestjs';

/**
 * Error and performance reporting to Sentry (kutz/university-api). Must be the first import in
 * main.ts: the SDK patches Fastify, pg and http as they are required, so anything loaded before
 * this runs goes untraced.
 *
 * Off unless SENTRY_DSN is set, which only the production stack (.ci/stack.yml) does, so local
 * runs and the CI test stack never report.
 */
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NODE_ENV ?? 'development',
  // The deployed commit (set by the Docker build), so performance can be compared across deploys.
  release: process.env.SENTRY_RELEASE || undefined,
  // A share of requests traced end to end (route, handler, SQL), enough to see where a slow
  // endpoint spends its time without sending every request.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
});
