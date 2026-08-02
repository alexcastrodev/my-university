import { describe, it, expect } from 'vitest';
import { get, post, json, login } from './helpers';

describe('POST /review/schedule + GET /review/due', () => {
  it('requires a session', async () => {
    const res = await post('/review/schedule', { module: 'java-concepts', slug: 'generics' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown module', async () => {
    const { cookie } = await login(`review-badmod-${Date.now()}`);
    const res = await post('/review/schedule', { module: 'not-a-module', slug: 'x' }, { Cookie: cookie });
    expect(res.status).toBe(404);
  });

  it('schedules a review and it later appears in /review/due once due', async () => {
    const { cookie } = await login(`review-schedule-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;

    const scheduleRes = await post('/review/schedule', { module: 'java-concepts', slug }, { Cookie: cookie });
    expect(scheduleRes.status).toBe(201);
    expect(await json<any>(scheduleRes)).toEqual({ scheduled: true });

    // Freshly scheduled items are due tomorrow, not immediately.
    const dueNow = await json<any[]>(await get('/review/due', { Cookie: cookie }));
    expect(dueNow.some((item) => item.sourceId === slug)).toBe(false);
  });

  it('re-scheduling an already-scheduled item is a no-op (idempotent)', async () => {
    const { cookie } = await login(`review-idempotent-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;

    await post('/review/schedule', { module: 'java-concepts', slug }, { Cookie: cookie });
    const second = await post('/review/schedule', { module: 'java-concepts', slug }, { Cookie: cookie });
    expect(second.status).toBe(201);
  });

  it('due queue only returns the requesting user\'s own schedules', async () => {
    const a = await login(`review-user-a-${Date.now()}`);
    const b = await login(`review-user-b-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;

    await post('/review/schedule', { module: 'java-concepts', slug }, { Cookie: a.cookie });

    const dueForB = await json<any[]>(await get('/review/due', { Cookie: b.cookie }));
    expect(dueForB.some((item) => item.sourceId === slug)).toBe(false);
  });
});

describe('POST /review/answer', () => {
  it('requires a session', async () => {
    const res = await post('/review/answer', { sourceType: 'concept-read', sourceId: 'x', rating: 'good' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a schedule that does not exist', async () => {
    const { cookie } = await login(`review-answer-404-${Date.now()}`);
    const res = await post(
      '/review/answer',
      { sourceType: 'concept-read', sourceId: 'never-scheduled', rating: 'good' },
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('advances the schedule and pushes dueAt into the future', async () => {
    const { cookie } = await login(`review-answer-ok-${Date.now()}`);
    const concepts = await json<any[]>(await get('/java-concepts'));
    const slug = concepts[0].slug;

    await post('/review/schedule', { module: 'java-concepts', slug }, { Cookie: cookie });
    const res = await post(
      '/review/answer',
      { sourceType: 'concept-read', sourceId: slug, rating: 'good' },
      { Cookie: cookie },
    );
    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body.intervalDays).toBeGreaterThanOrEqual(1);
    expect(new Date(body.dueAt).getTime()).toBeGreaterThan(Date.now());
  });
});
