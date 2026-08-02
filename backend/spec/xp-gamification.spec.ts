import { describe, it, expect } from 'vitest';
import { get, put, json, login } from './helpers';

const CONCEPT_SLUG = 'iterator-vs-iterable';

describe('GET /xp/streak', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await get('/xp/streak');
    expect(res.status).toBe(401);
  });

  it('is 0/0 for a fresh user with no XP entries', async () => {
    const { cookie } = await login(`streak-fresh-${Date.now()}`);
    const res = await get('/xp/streak', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<{ current: number; longest: number }>(res);
    expect(body).toEqual({ current: 0, longest: 0 });
  });

  it('is 1/1 right after earning XP today', async () => {
    const { cookie } = await login(`streak-today-${Date.now()}`);
    await put(`/java-concepts/${CONCEPT_SLUG}/read`, {}, { Cookie: cookie });

    const res = await get('/xp/streak', { Cookie: cookie });
    const body = await json<{ current: number; longest: number }>(res);
    expect(body).toEqual({ current: 1, longest: 1 });
  });
});

describe('GET /xp/daily-goal', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await get('/xp/daily-goal');
    expect(res.status).toBe(401);
  });

  it('starts at 0 earned with the fixed goal for a fresh user', async () => {
    const { cookie } = await login(`daily-goal-fresh-${Date.now()}`);
    const res = await get('/xp/daily-goal', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<{ earnedToday: number; goal: number }>(res);
    expect(body.earnedToday).toBe(0);
    expect(body.goal).toBeGreaterThan(0);
  });

  it('earnedToday increases after earning XP, goal stays fixed', async () => {
    const { cookie } = await login(`daily-goal-earn-${Date.now()}`);
    const before = await json<{ earnedToday: number; goal: number }>(
      await get('/xp/daily-goal', { Cookie: cookie }),
    );
    expect(before.earnedToday).toBe(0);

    await put(`/java-concepts/${CONCEPT_SLUG}/read`, {}, { Cookie: cookie });

    const after = await json<{ earnedToday: number; goal: number }>(
      await get('/xp/daily-goal', { Cookie: cookie }),
    );
    expect(after.earnedToday).toBeGreaterThan(before.earnedToday);
    expect(after.goal).toBe(before.goal);
  });
});

describe('GET /xp/leaderboard', () => {
  it('returns 401 when no session cookie is present', async () => {
    const res = await get('/xp/leaderboard');
    expect(res.status).toBe(401);
  });

  it('lists the current user once they have XP, with the right shape', async () => {
    const displayName = `leaderboard-user-${Date.now()}`;
    const { id, cookie } = await login(displayName);
    await put(`/java-concepts/${CONCEPT_SLUG}/read`, {}, { Cookie: cookie });

    const res = await get('/xp/leaderboard', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<
      { userId: number; displayName: string; avatarUrl: string; total: number; levelNumber: number }[]
    >(res);

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(10);

    const entry = body.find((row) => row.userId === id);
    expect(entry).toBeDefined();
    expect(entry!.total).toBeGreaterThan(0);
    expect(entry!.levelNumber).toBeGreaterThanOrEqual(1);
    expect(typeof entry!.displayName).toBe('string');
  });

  it('shows the display name override, not the raw GitHub name, once set', async () => {
    const { id, cookie } = await login(`leaderboard-override-${Date.now()}`);
    await put(`/java-concepts/${CONCEPT_SLUG}/read`, {}, { Cookie: cookie });
    await put('/auth/settings', { displayName: 'Overridden Name' }, { Cookie: cookie });

    const res = await get('/xp/leaderboard', { Cookie: cookie });
    const body = await json<{ userId: number; displayName: string }[]>(res);

    const entry = body.find((row) => row.userId === id);
    expect(entry?.displayName).toBe('Overridden Name');
  });

  it('is ordered by total XP descending', async () => {
    const { cookie } = await login(`leaderboard-order-${Date.now()}`);
    const res = await get('/xp/leaderboard', { Cookie: cookie });
    const body = await json<{ total: number }[]>(res);

    for (let i = 1; i < body.length; i++) {
      expect(body[i - 1].total).toBeGreaterThanOrEqual(body[i].total);
    }
  });
});
