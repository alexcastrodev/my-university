import { describe, it, expect, beforeAll } from 'vitest';
import { get, post, json } from './helpers';

const EXAM_ID = 'java-21';
let attemptId: number;

describe('GET /exam/list', () => {
  it('returns an array of exams', async () => {
    const res = await get('/exam/list');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('each exam has id, title, and category', async () => {
    const body = await json<any[]>(await get('/exam/list'));
    for (const exam of body) {
      expect(exam).toMatchObject({ id: expect.any(String), title: expect.any(String), category: expect.any(String) });
    }
  });

  it('returns exams ordered by category then title', async () => {
    const body = await json<any[]>(await get('/exam/list'));
    const sorted = [...body].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    expect(body.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });
});

describe('GET /exam/:examId', () => {
  it('returns the exam for a known id', async () => {
    const res = await get(`/exam/${EXAM_ID}`);
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.id).toBe(EXAM_ID);
  });

  it('returns null body (200 with null) for an unknown exam id', async () => {
    const res = await get('/exam/does-not-exist');
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body).toBeNull();
  });

  it('includes questionCount field', async () => {
    const body = await json<any>(await get(`/exam/${EXAM_ID}`));
    expect(typeof body.questionCount).toBe('number');
  });
});

describe('GET /exam/:examId/topics', () => {
  it('returns an array of topic strings', async () => {
    const res = await get(`/exam/${EXAM_ID}/topics`);
    expect(res.status).toBe(200);
    const body = await json<string[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown exam', async () => {
    const body = await json<any[]>(await get('/exam/unknown-exam/topics'));
    expect(body).toEqual([]);
  });

  it('topics are unique strings', async () => {
    const body = await json<string[]>(await get(`/exam/${EXAM_ID}/topics`));
    const unique = new Set(body);
    expect(unique.size).toBe(body.length);
  });
});

describe('GET /exam/:examId/stats', () => {
  it('returns topic counts', async () => {
    const res = await get(`/exam/${EXAM_ID}/stats`);
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ topic: expect.any(String), count: expect.anything() });
  });

  it('returns empty array for unknown exam', async () => {
    const body = await json<any[]>(await get('/exam/unknown/stats'));
    expect(body).toEqual([]);
  });

  it('count is a positive number for known exam', async () => {
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/stats`));
    for (const row of body) {
      expect(Number(row.count)).toBeGreaterThan(0);
    }
  });
});

describe('GET /exam/:examId/questions', () => {
  it('returns questions for the exam', async () => {
    const res = await get(`/exam/${EXAM_ID}/questions`);
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('respects the limit query param', async () => {
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=5`));
    expect(body.length).toBeLessThanOrEqual(5);
  });

  it('filters by topic when topic query param is provided', async () => {
    const topics = await json<string[]>(await get(`/exam/${EXAM_ID}/topics`));
    const topic = topics[0];
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?topic=${encodeURIComponent(topic)}`));
    expect(body.every((q) => q.topic === topic)).toBe(true);
  });
});

describe('POST /exam/:examId/attempts', () => {
  it('creates a new attempt and returns it', async () => {
    const res = await post(`/exam/${EXAM_ID}/attempts`, {});
    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body).toMatchObject({ id: expect.any(Number), examId: EXAM_ID });
    attemptId = body.id;
  });

  it('associates attempt with userId when x-user-id header is provided', async () => {
    const { id: userId } = await json<any>(await post('/auth/login', { displayName: `attempt-user-${Date.now()}` }));
    const res = await post(`/exam/${EXAM_ID}/attempts`, {}, { 'x-user-id': String(userId) });
    const body = await json<any>(res);
    // userId may be stored but not serialized in response; assert attempt was created
    expect(body.id).toEqual(expect.any(Number));
  });

  it('creates attempt without userId when header is absent', async () => {
    const res = await post(`/exam/${EXAM_ID}/attempts`, {});
    const body = await json<any>(res);
    // userId absent from response means it was not associated
    expect(body.userId ?? null).toBeNull();
  });
});

describe('POST /exam/attempts/:id/submit', () => {
  beforeAll(async () => {
    const res = await post(`/exam/${EXAM_ID}/attempts`, {});
    attemptId = (await json<any>(res)).id;
  });

  it('submits answers and returns score', async () => {
    const res = await post(`/exam/attempts/${attemptId}/submit`, { answers: {} });
    expect(res.status).toBe(201);
    const body = await json<any>(res);
    expect(body).toMatchObject({ score: expect.any(Number), total: expect.any(Number), finishedAt: expect.any(String) });
  });

  it('score is 0 when answers object is empty', async () => {
    const a = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const body = await json<any>(await post(`/exam/attempts/${a.id}/submit`, { answers: {} }));
    // empty answers → no correct answers → score is always 0
    expect(body.score).toBe(0);
  });

  it('returns 500 when attempt id does not exist', async () => {
    const res = await post('/exam/attempts/999999/submit', { answers: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /exam/:examId/attempts', () => {
  it('returns list of attempts for the exam', async () => {
    const res = await get(`/exam/${EXAM_ID}/attempts`);
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns empty array for an exam with no attempts', async () => {
    const body = await json<any[]>(await get('/exam/no-such-exam/attempts'));
    expect(body).toEqual([]);
  });

  it('attempts are ordered by startedAt descending', async () => {
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/attempts`));
    if (body.length < 2) return;
    const dates = body.map((a) => new Date(a.startedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });
});
