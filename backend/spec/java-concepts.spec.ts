import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

describe('GET /java-concepts', () => {
  it('returns a list of concept summaries', async () => {
    const res = await get('/java-concepts');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('summaries expose slug, id, title, summary and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get('/java-concepts'));
    const concept = body.find((c) => c.slug === 'iterator-vs-iterable');
    expect(concept).toMatchObject({
      slug: 'iterator-vs-iterable',
      id: 1,
      title: expect.any(String),
      summary: expect.any(String),
      publishedAt: expect.any(String),
    });
    expect(concept.sections).toBeUndefined();
  });

  it('is ordered by id, highest first', async () => {
    const body = await json<any[]>(await get('/java-concepts'));
    const ids = body.map((c) => c.id);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });
});

describe('GET /java-concepts/:slug', () => {
  it('returns the full concept for a known slug', async () => {
    const res = await get('/java-concepts/iterator-vs-iterable');
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('iterator-vs-iterable');
    expect(body.version).toBe('1.0');
    expect(body.updatedAt).toBe('2026-07-25');
  });

  it('splits the markdown body into the fixed concept sections', async () => {
    const body = await json<any>(
      await get('/java-concepts/iterator-vs-iterable'),
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
      await get('/java-concepts/iterator-vs-iterable'),
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
    const res = await get('/java-concepts/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/java-concepts/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});

describe('PUT /java-concepts/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`concept-404-${Date.now()}`);
    const res = await put(
      '/java-concepts/does-not-exist/read',
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put('/java-concepts/iterator-vs-iterable/read', {}, {});
    expect(res.status).toBe(401);
  });

  it('grants XP once and is idempotent on repeated calls', async () => {
    const { cookie } = await login(`concept-read-${Date.now()}`);
    const before = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;

    const res1 = await put(
      '/java-concepts/iterator-vs-iterable/read',
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
      '/java-concepts/iterator-vs-iterable/read',
      {},
      { Cookie: cookie },
    );
    const afterSecond = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterSecond).toBe(afterFirst);
  });
});
