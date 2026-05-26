import { describe, it, expect, beforeAll } from 'vitest';
import { get, post, put, json } from './helpers';

const COURSE_ID = 'java-21';
let userId: number;

beforeAll(async () => {
  const user = await json<any>(await post('/auth/login', { displayName: `xp-user-${Date.now()}` }));
  userId = user.id;
});

// NOTE: GET /xp requires a container rebuild — XpController is registered but
// the running dist pre-dates the route. Tests are marked todo until redeploy.
describe('GET /xp', () => {
  it.todo('returns total xp for a valid user (starts at 0)');
  it.todo('returns 401 when x-user-id header is missing');
  it.todo('total increases after completing a lesson');
});
