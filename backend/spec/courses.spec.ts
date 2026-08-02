import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

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

describe('GET /courses/resume', () => {
  it('requires a session', async () => {
    const res = await get('/courses/resume');
    expect(res.status).toBe(401);
  });

  it('returns null when the user has not completed any lesson', async () => {
    const { cookie } = await login(`resume-none-${Date.now()}`);
    const res = await get('/courses/resume', { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(await json<any>(res)).toBeNull();
  });

  it('returns the next lesson after the most recently completed one', async () => {
    const { cookie } = await login(`resume-next-${Date.now()}`);
    const course = await json<any>(await get(`/courses/${COURSE_ID}`));
    const lessons = course.modules.flatMap((m: any) => m.lessons);
    const firstLesson = lessons[0];
    const secondLesson = lessons[1];

    await put(`/progress/${COURSE_ID}/${firstLesson.id}`, { status: 'completed' }, { Cookie: cookie });

    const res = await get('/courses/resume', { Cookie: cookie });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.courseId).toBe(COURSE_ID);
    expect(body.lessonId).toBe(secondLesson.id);
  });

  it('returns a null lessonId when the completed lesson was the last one in the course', async () => {
    const { cookie } = await login(`resume-last-${Date.now()}`);
    const course = await json<any>(await get(`/courses/${COURSE_ID}`));
    const lessons = course.modules.flatMap((m: any) => m.lessons);
    const lastLesson = lessons[lessons.length - 1];

    await put(`/progress/${COURSE_ID}/${lastLesson.id}`, { status: 'completed' }, { Cookie: cookie });

    const res = await get('/courses/resume', { Cookie: cookie });
    const body = await json<any>(res);
    expect(body.courseId).toBe(COURSE_ID);
    expect(body.lessonId).toBeNull();
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
