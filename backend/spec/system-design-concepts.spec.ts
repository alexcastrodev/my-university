import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

describe('GET /system-design-concepts', () => {
  it('returns a list of concept summaries', async () => {
    const res = await get('/system-design-concepts');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('summaries expose the rich metadata fields but no sections', async () => {
    const body = await json<any[]>(await get('/system-design-concepts'));
    const concept = body.find((c) => c.slug === 'outbox-pattern');
    expect(concept).toMatchObject({
      slug: 'outbox-pattern',
      id: 1,
      title: expect.any(String),
      summary: expect.any(String),
      publishedAt: expect.any(String),
      difficulty: expect.stringMatching(/^(Beginner|Intermediate|Advanced)$/),
      readingTime: expect.any(Number),
      tags: expect.arrayContaining([expect.any(String)]),
      prerequisites: expect.arrayContaining([expect.any(String)]),
      related: expect.arrayContaining([expect.any(String)]),
    });
    expect(concept.sections).toBeUndefined();
    expect(concept.references).toBeUndefined();
  });

  it('is ordered by id, highest first', async () => {
    const body = await json<any[]>(await get('/system-design-concepts'));
    const ids = body.map((c) => c.id);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });
});

describe('GET /system-design-concepts/:slug', () => {
  it('returns the full concept for a known slug', async () => {
    const res = await get('/system-design-concepts/outbox-pattern');
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('outbox-pattern');
    expect(body.difficulty).toBe('Intermediate');
    expect(body.tags).toContain('Distributed Systems');
  });

  it('splits the markdown body into sections without locking a fixed set', async () => {
    const body = await json<any>(await get('/system-design-concepts/outbox-pattern'));
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
    const titles = body.sections.map((s: any) => s.title);
    expect(titles).toContain('Overview');
    expect(titles).toContain('References');
  });

  it('includes structured references with label, url and type', async () => {
    const body = await json<any>(await get('/system-design-concepts/outbox-pattern'));
    expect(body.references.length).toBeGreaterThan(0);
    for (const ref of body.references) {
      expect(ref).toMatchObject({
        label: expect.any(String),
        url: expect.any(String),
        type: expect.stringMatching(/^(book|paper|engineering|doc|video)$/),
      });
    }
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await get('/system-design-concepts/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/system-design-concepts/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});

describe('PUT /system-design-concepts/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`sysdesign-concept-404-${Date.now()}`);
    const res = await put(
      '/system-design-concepts/does-not-exist/read',
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put('/system-design-concepts/outbox-pattern/read', {}, {});
    expect(res.status).toBe(401);
  });

  it('grants XP once and is idempotent on repeated calls', async () => {
    const { cookie } = await login(`sysdesign-concept-read-${Date.now()}`);
    const before = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;

    const res1 = await put(
      '/system-design-concepts/outbox-pattern/read',
      {},
      { Cookie: cookie },
    );
    expect(res1.status).toBe(200);
    expect((await json<any>(res1)).read).toBe(true);

    const afterFirst = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterFirst).toBe(before + 10);

    await put(
      '/system-design-concepts/outbox-pattern/read',
      {},
      { Cookie: cookie },
    );
    const afterSecond = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterSecond).toBe(afterFirst);
  });
});
