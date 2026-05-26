import { describe, it, expect, beforeAll } from 'vitest';
import { get, post, put, json } from './helpers';

const COURSE_ID = 'java-21';
let userId: number;
let lessonId: string;

beforeAll(async () => {
  const user = await json<any>(await post('/auth/login', { displayName: `progress-user-${Date.now()}` }));
  userId = user.id;

  const course = await json<any>(await get(`/courses/${COURSE_ID}`));
  lessonId = course.modules[0].lessons[0].id;
});

describe('GET /progress/:courseId', () => {
  it('returns an empty map for a user with no progress', async () => {
    const res = await get(`/progress/${COURSE_ID}`, { 'x-user-id': String(userId) });
    expect(res.status).toBe(200);
    const body = await json<Record<string, string>>(res);
    expect(typeof body).toBe('object');
    expect(Object.keys(body).length).toBe(0);
  });

  it('returns 401 when x-user-id is missing', async () => {
    const res = await get(`/progress/${COURSE_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns lesson statuses after progress is recorded', async () => {
    await put(`/progress/${COURSE_ID}/${lessonId}`, { status: 'completed' }, { 'x-user-id': String(userId) });
    const body = await json<Record<string, string>>(await get(`/progress/${COURSE_ID}`, { 'x-user-id': String(userId) }));
    expect(body[lessonId]).toBe('completed');
  });
});

describe('PUT /progress/:courseId/:lessonId', () => {
  it('creates a progress entry and returns it', async () => {
    const newLesson = (await json<any>(await get(`/courses/${COURSE_ID}`))).modules[0].lessons[1]?.id ?? lessonId;
    const res = await put(`/progress/${COURSE_ID}/${newLesson}`, { status: 'in-progress' }, { 'x-user-id': String(userId) });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.status).toBe('in-progress');
  });

  it('updates an existing progress entry when called again', async () => {
    await put(`/progress/${COURSE_ID}/${lessonId}`, { status: 'in-progress' }, { 'x-user-id': String(userId) });
    const res = await put(`/progress/${COURSE_ID}/${lessonId}`, { status: 'completed' }, { 'x-user-id': String(userId) });
    const body = await json<any>(res);
    expect(body.status).toBe('completed');
  });

  it('returns 4xx or 5xx when x-user-id refers to a non-existent user', async () => {
    const res = await put(`/progress/${COURSE_ID}/${lessonId}`, { status: 'completed' }, { 'x-user-id': '999999' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
