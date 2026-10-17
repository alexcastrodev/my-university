import { NotFoundException } from '@nestjs/common';

/**
 * The login shortcuts (dev-login, and the test-only login/reset) skip GitHub entirely, so they
 * need an explicit opt-in: `ENABLE_DEV_AUTH=1`. Checking only `NODE_ENV !== 'production'` would
 * leave them open to the world the day a production container starts without NODE_ENV. Even
 * with the flag set, production never serves them.
 */
export function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_DEV_AUTH === '1' && env.NODE_ENV !== 'production';
}

/** 404 (not 403) so a production probe cannot tell the route exists. */
export function assertDevAuth(): void {
  if (!devAuthEnabled()) throw new NotFoundException();
}
