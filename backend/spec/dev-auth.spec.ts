import { describe, expect, it } from 'vitest';
import { devAuthEnabled } from '../src/auth/dev-auth';

describe('devAuthEnabled', () => {
  it('is off unless explicitly opted in', () => {
    expect(devAuthEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(devAuthEnabled({})).toBe(false);
  });

  it('is on only with the flag and outside production', () => {
    expect(devAuthEnabled({ NODE_ENV: 'development', ENABLE_DEV_AUTH: '1' })).toBe(true);
    expect(devAuthEnabled({ ENABLE_DEV_AUTH: '1' })).toBe(true);
  });

  it('stays off in production even with the flag', () => {
    expect(devAuthEnabled({ NODE_ENV: 'production', ENABLE_DEV_AUTH: '1' })).toBe(false);
  });
});
