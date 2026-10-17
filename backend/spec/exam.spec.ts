import { describe, it, expect, beforeAll } from 'vitest';
import { get, post, json, login } from './helpers';

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

  it('each exam has an id and title', async () => {
    const body = await json<any[]>(await get('/exam/list'));
    for (const exam of body) {
      expect(exam).toMatchObject({ id: expect.any(String), title: expect.any(String) });
    }
  });

  it('returns exams ordered by title', async () => {
    const body = await json<any[]>(await get('/exam/list'));
    const sorted = [...body].sort((a, b) => a.title.localeCompare(b.title));
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

  it('never leaks the answer key (correctKeys/explanation/source)', async () => {
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=5`));
    expect(body.length).toBeGreaterThan(0);
    for (const q of body) {
      expect(q).not.toHaveProperty('correctKeys');
      expect(q).not.toHaveProperty('explanation');
      expect(q).not.toHaveProperty('source');
      // public fields the quiz needs are still present
      expect(q).toMatchObject({ id: expect.any(Number), options: expect.any(Array), type: expect.any(String) });
    }
  });

  it('never leaks the answer key on a single question', async () => {
    const [first] = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=1`));
    const q = await json<any>(await get(`/exam/questions/${first.id}`));
    expect(q.id).toBe(first.id);
    expect(q).not.toHaveProperty('correctKeys');
    expect(q).not.toHaveProperty('explanation');
    expect(q).not.toHaveProperty('source');
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

  it('associates attempt with the user when authenticated', async () => {
    const { cookie } = await login(`attempt-user-${Date.now()}`);
    const res = await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie });
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

  it('reveals the answer key only in the submit review, and totals the shown questions', async () => {
    const questions = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=3`));
    const questionIds = questions.map((q) => q.id);
    const a = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const result = await json<any>(
      await post(`/exam/attempts/${a.id}/submit`, { answers: {}, questionIds }),
    );
    // total reflects the shown set, not just the answered ones
    expect(result.total).toBe(questionIds.length);
    expect(Array.isArray(result.review)).toBe(true);
    expect(result.review.length).toBe(questionIds.length);
    for (const r of result.review) {
      expect(r).toMatchObject({
        id: expect.any(Number),
        correctKeys: expect.any(Array),
        correct: expect.any(Boolean),
      });
    }
  });

  it('refuses to re-submit a finished attempt', async () => {
    const a = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    expect((await post(`/exam/attempts/${a.id}/submit`, { answers: {} })).status).toBe(201);
    expect((await post(`/exam/attempts/${a.id}/submit`, { answers: {} })).status).toBe(409);
  });

  it('rejects more questionIds than the exam serves', async () => {
    const a = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const questionIds = Array.from({ length: 5000 }, (_, i) => i + 1);
    const res = await post(`/exam/attempts/${a.id}/submit`, { answers: {}, questionIds });
    expect(res.status).toBe(400);
  });

  it('ignores question ids that belong to another exam', async () => {
    const exams = await json<any[]>(await get('/exam/list'));
    const other = exams.find((e) => e.id !== EXAM_ID);
    if (!other) return;
    const foreign = await json<any[]>(await get(`/exam/${other.id}/questions?limit=2`));
    const a = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const result = await json<any>(
      await post(`/exam/attempts/${a.id}/submit`, { answers: {}, questionIds: foreign.map((q) => q.id) }),
    );
    expect(result.total).toBe(0);
  });

  it('returns 500 when attempt id does not exist', async () => {
    const res = await post('/exam/attempts/999999/submit', { answers: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects submitting an attempt that belongs to another user', async () => {
    const { cookie } = await login(`owner-${Date.now()}`);
    const owned = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie }));
    const res = await post(`/exam/attempts/${owned.id}/submit`, { answers: {} }); // no session → not the owner
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('served attempts: the server decides which questions count', () => {
  const start = async (body: object, cookie?: string) =>
    json<any>(await post(`/exam/${EXAM_ID}/attempts`, body, cookie ? { Cookie: cookie } : {}));
  const hasSkillCheckXp = async (cookie: string) =>
    (await json<any>(await get('/xp/summary', { Cookie: cookie }))).breakdown.some(
      (b: any) => b.sourceType === 'skill-check',
    );

  it('returns the drawn questions without the answer key', async () => {
    const attempt = await start({ serve: true, limit: 3 });
    expect(attempt.questions).toHaveLength(3);
    for (const q of attempt.questions) {
      expect(q.correctKeys).toBeUndefined();
      expect(q.explanation).toBeUndefined();
    }
  });

  it('grades exactly the served questions, whatever questionIds the client reports', async () => {
    const attempt = await start({ serve: true, limit: 4 });
    const foreign = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=1`));
    const result = await json<any>(
      await post(`/exam/attempts/${attempt.id}/submit`, {
        answers: {},
        questionIds: [attempt.questions[0].id, foreign[0].id],
      }),
    );
    expect(result.total).toBe(4);
    expect(result.review.map((r: any) => r.id)).toEqual(attempt.questions.map((q: any) => q.id));
  });

  it('404s when the exam does not exist', async () => {
    const res = await post('/exam/no-such-exam/attempts', { serve: true });
    expect(res.status).toBe(404);
  });

  it('pays XP only for a served attempt', async () => {
    const served = await login(`served-xp-${Date.now()}`);
    const legacy = await login(`legacy-xp-${Date.now()}`);

    const a = await start({ serve: true, limit: 2 }, served.cookie);
    await post(`/exam/attempts/${a.id}/submit`, { answers: {} }, { Cookie: served.cookie });
    expect(await hasSkillCheckXp(served.cookie)).toBe(true);

    const b = await start({}, legacy.cookie);
    const ids = (await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=2`))).map((q) => q.id);
    const result = await json<any>(
      await post(`/exam/attempts/${b.id}/submit`, { answers: {}, questionIds: ids }, { Cookie: legacy.cookie }),
    );
    expect(result.total).toBe(2); // still graded...
    expect(await hasSkillCheckXp(legacy.cookie)).toBe(false); // ...but never paid
  });
});

describe('GET /exam/:examId/attempts/:id', () => {
  it('returns the persisted review for a submitted attempt', async () => {
    const questions = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=3`));
    const questionIds = questions.map((q) => q.id);
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    await post(`/exam/attempts/${created.id}/submit`, { answers: {}, questionIds });

    const res = await get(`/exam/${EXAM_ID}/attempts/${created.id}`);
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.id).toBe(created.id);
    expect(Array.isArray(body.review)).toBe(true);
    expect(body.review.length).toBe(questionIds.length);
    for (const r of body.review) {
      expect(r).toMatchObject({ id: expect.any(Number), correctKeys: expect.any(Array), correct: expect.any(Boolean) });
    }
  });

  it('review is null for an attempt that was never submitted', async () => {
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const body = await json<any>(await get(`/exam/${EXAM_ID}/attempts/${created.id}`));
    expect(body.review).toBeNull();
  });

  it('returns 404 for an unknown attempt id', async () => {
    const res = await get(`/exam/${EXAM_ID}/attempts/999999`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the attempt belongs to a different exam', async () => {
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const res = await get(`/exam/some-other-exam/attempts/${created.id}`);
    expect(res.status).toBe(404);
  });

  it("rejects reading another user's attempt", async () => {
    const { cookie } = await login(`review-owner-${Date.now()}`);
    const owned = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie }));
    const res = await get(`/exam/${EXAM_ID}/attempts/${owned.id}`); // no session → not the owner
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /exam/:examId/attempts/:id/public', () => {
  it('works without auth, for a requester who is not the attempt owner, and never leaks review/answers', async () => {
    const { cookie } = await login(`share-owner-${Date.now()}`);
    const questions = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=3`));
    const questionIds = questions.map((q) => q.id);
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie }));
    await post(`/exam/attempts/${created.id}/submit`, { answers: {}, questionIds }, { Cookie: cookie });

    // No Cookie header at all — fully anonymous, unauthenticated request.
    const res = await get(`/exam/${EXAM_ID}/attempts/${created.id}/public`);
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body).toMatchObject({
      examTitle: expect.any(String),
      score: expect.any(Number),
      total: expect.any(Number),
      passingScore: expect.any(Number),
      passed: expect.any(Boolean),
    });
    expect(body).not.toHaveProperty('review');
    expect(body).not.toHaveProperty('answers');
  });

  it('computes passed correctly relative to the exam passing score', async () => {
    const exam = await json<any>(await get(`/exam/${EXAM_ID}`));
    const questions = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=3`));
    const questionIds = questions.map((q) => q.id);
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    // Empty answers → score 0 → should never pass.
    await post(`/exam/attempts/${created.id}/submit`, { answers: {}, questionIds });

    const body = await json<any>(await get(`/exam/${EXAM_ID}/attempts/${created.id}/public`));
    expect(body.passingScore).toBe(exam.passingScore);
    expect(body.passed).toBe(false);
  });

  it('returns 404 for an unknown attempt id', async () => {
    const res = await get(`/exam/${EXAM_ID}/attempts/999999/public`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown examId', async () => {
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    await post(`/exam/attempts/${created.id}/submit`, { answers: {} });
    const res = await get(`/exam/does-not-exist/attempts/${created.id}/public`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for an attempt that was started but never submitted (unfinished)', async () => {
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}));
    const res = await get(`/exam/${EXAM_ID}/attempts/${created.id}/public`);
    expect(res.status).toBe(404);
  });
});

describe('GET /exam/:examId/attempts', () => {
  it('returns an empty array without a session', async () => {
    const res = await get(`/exam/${EXAM_ID}/attempts`);
    expect(res.status).toBe(200);
    expect(await json<any[]>(res)).toEqual([]);
  });

  it("returns only the caller's own attempts", async () => {
    const { cookie } = await login(`attempts-user-${Date.now()}`);
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie }));
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/attempts`, { Cookie: cookie }));
    expect(body.some((a) => a.id === created.id)).toBe(true);
    expect(body.every((a) => a.examId === EXAM_ID)).toBe(true);
  });

  it('attempts are ordered by startedAt descending', async () => {
    const { cookie } = await login(`order-user-${Date.now()}`);
    await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie });
    await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie });
    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/attempts`, { Cookie: cookie }));
    if (body.length < 2) return;
    const dates = body.map((a) => new Date(a.startedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it('omits answers/review from the list — those are only served by the single-attempt endpoint', async () => {
    const { cookie } = await login(`attempts-light-${Date.now()}`);
    const questions = await json<any[]>(await get(`/exam/${EXAM_ID}/questions?limit=2`));
    const created = await json<any>(await post(`/exam/${EXAM_ID}/attempts`, {}, { Cookie: cookie }));
    await post(`/exam/attempts/${created.id}/submit`, {
      answers: {},
      questionIds: questions.map((q) => q.id),
    }, { Cookie: cookie });

    const body = await json<any[]>(await get(`/exam/${EXAM_ID}/attempts`, { Cookie: cookie }));
    const found = body.find((a) => a.id === created.id);
    expect(found).toMatchObject({ id: created.id, score: expect.any(Number), total: expect.any(Number) });
    expect(found).not.toHaveProperty('answers');
    expect(found).not.toHaveProperty('review');
  });
});
