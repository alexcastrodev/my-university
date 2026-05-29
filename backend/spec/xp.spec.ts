import { describe, it, expect, beforeAll } from 'vitest';
import { get, put, json, login } from './helpers';

const COURSE_ID = 'java-21';
let lessonId: string;

beforeAll(async () => {
  const course = await json<any>(await get(`/courses/${COURSE_ID}`));
  lessonId = course.modules[0].lessons[0].id;
});

describe('GET /xp', () => {
  it('returns total xp for a fresh user (starts at 0)', async () => {
    const { cookie } = await login(`xp-fresh-${Date.now()}`);
    const res = await get('/xp', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<{ total: number }>(res);
    expect(body.total).toBe(0);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await get('/xp');
    expect(res.status).toBe(401);
  });

  it('total increases after completing a lesson', async () => {
    const { cookie } = await login(`xp-lesson-${Date.now()}`);
    const before = (await json<{ total: number }>(await get('/xp', { Cookie: cookie }))).total;
    expect(before).toBe(0);

    await put(`/progress/${COURSE_ID}/${lessonId}`, { status: 'completed' }, { Cookie: cookie });

    const after = (await json<{ total: number }>(await get('/xp', { Cookie: cookie }))).total;
    expect(after).toBeGreaterThan(before);
  });
});
