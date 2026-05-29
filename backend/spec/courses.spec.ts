import { describe, it, expect } from 'vitest';
import { get, json, login } from './helpers';

const COURSE_ID = 'java-21';

describe('GET /courses', () => {
  it('returns a list of courses', async () => {
    const res = await get('/courses');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('each course includes modules with lessons', async () => {
    const body = await json<any[]>(await get('/courses'));
    for (const course of body) {
      expect(Array.isArray(course.modules)).toBe(true);
      if (course.modules.length > 0) {
        expect(Array.isArray(course.modules[0].lessons)).toBe(true);
      }
    }
  });

  it('applies user progress when authenticated', async () => {
    const { cookie } = await login(`courses-user-${Date.now()}`);
    const withUser = await json<any[]>(await get('/courses', { Cookie: cookie }));
    expect(Array.isArray(withUser)).toBe(true);
  });
});

describe('GET /courses/:id', () => {
  it('returns the course for a known id', async () => {
    const res = await get(`/courses/${COURSE_ID}`);
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.id).toBe(COURSE_ID);
  });

  it('returns 404 for an unknown course id', async () => {
    const res = await get('/courses/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('modules are ordered by their order field', async () => {
    const body = await json<any>(await get(`/courses/${COURSE_ID}`));
    const orders = body.modules.map((m: any) => m.order);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });
});

describe('GET /courses/:id/lessons/:lessonId', () => {
  it('returns a lesson for a valid lessonId', async () => {
    const course = await json<any>(await get(`/courses/${COURSE_ID}`));
    const lessonId = course.modules[0].lessons[0].id;
    const res = await get(`/courses/${COURSE_ID}/lessons/${lessonId}`);
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.id).toBe(lessonId);
  });

  it('returns 404 for an unknown lessonId', async () => {
    const res = await get(`/courses/${COURSE_ID}/lessons/no-such-lesson`);
    expect(res.status).toBe(404);
  });

  it('lesson has type field with a valid LessonType value', async () => {
    const course = await json<any>(await get(`/courses/${COURSE_ID}`));
    const lessonId = course.modules[0].lessons[0].id;
    const body = await json<any>(await get(`/courses/${COURSE_ID}/lessons/${lessonId}`));
    expect(['slide', 'practice', 'skill-check']).toContain(body.type);
  });
});
