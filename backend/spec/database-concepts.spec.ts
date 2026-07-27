import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

describe('GET /database-concepts', () => {
  it('returns a list of concept summaries', async () => {
    const res = await get('/database-concepts');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('summaries expose slug, id, category, title, summary and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get('/database-concepts'));
    const concept = body.find(
      (c) => c.slug === 'postgresql-rpo-rto-planning',
    );
    expect(concept).toMatchObject({
      slug: 'postgresql-rpo-rto-planning',
      id: 1,
      category: 'PostgreSQL',
      title: expect.any(String),
      summary: expect.any(String),
      publishedAt: expect.any(String),
    });
    expect(concept.sections).toBeUndefined();
  });

  it('is ordered by id, highest first', async () => {
    const body = await json<any[]>(await get('/database-concepts'));
    const ids = body.map((c) => c.id);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });
});

describe('GET /database-concepts/:slug', () => {
  it('returns the full concept for a known slug', async () => {
    const res = await get('/database-concepts/postgresql-rpo-rto-planning');
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('postgresql-rpo-rto-planning');
    expect(body.category).toBe('PostgreSQL');
    expect(body.version).toBe('1.0');
    expect(body.updatedAt).toBe('2026-07-27');
  });

  it('splits the markdown body into the fixed concept sections', async () => {
    const body = await json<any>(
      await get('/database-concepts/postgresql-rpo-rto-planning'),
    );
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.map((s: any) => s.title)).toEqual([
      'Objective',
      'Use Cases',
      'Deep Dive',
      'Trade-offs',
      'Documentation Links',
    ]);
  });

  it('includes structured references with label, url and type', async () => {
    const body = await json<any>(
      await get('/database-concepts/postgresql-rpo-rto-planning'),
    );
    expect(body.references.length).toBeGreaterThan(0);
    for (const ref of body.references) {
      expect(ref).toMatchObject({
        label: expect.any(String),
        url: expect.any(String),
        type: expect.stringMatching(/^(video|doc)$/),
      });
    }
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await get('/database-concepts/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/database-concepts/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});

describe('PUT /database-concepts/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`database-concept-404-${Date.now()}`);
    const res = await put(
      '/database-concepts/does-not-exist/read',
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put(
      '/database-concepts/postgresql-rpo-rto-planning/read',
      {},
      {},
    );
    expect(res.status).toBe(401);
  });

  it('grants XP once and is idempotent on repeated calls', async () => {
    const { cookie } = await login(`database-concept-read-${Date.now()}`);
    const before = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;

    const res1 = await put(
      '/database-concepts/postgresql-rpo-rto-planning/read',
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
      '/database-concepts/postgresql-rpo-rto-planning/read',
      {},
      { Cookie: cookie },
    );
    const afterSecond = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterSecond).toBe(afterFirst);
  });
});
