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

  it('falls back to id, highest first, for concepts with no authored prerequisite', async () => {
    const body = await json<any[]>(await get('/database-concepts'));
    const hasRequires = new Set([
      'sql-pagination-top-n-and-extremes-per-group', 'sql-running-totals-and-moving-aggregates',
      'sql-moving-window-aggregations', 'sql-differences-between-adjacent-rows',
      'sql-gaps-and-islands', 'sql-median-mode-and-outliers', 'sql-buckets-and-histograms',
      'sql-subtotals-and-rollup', 'sql-recursive-hierarchy-queries',
      'sql-unpivoting-columns-to-rows', 'sql-delimited-data-and-lists',
      'sql-regex-pattern-matching-in-sql',
    ]);
    const ids = body.filter((c) => !hasRequires.has(c.slug)).map((c) => c.id);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });

  it('never places a concept before something it requires (SQL families)', async () => {
    const body = await json<any[]>(await get('/database-concepts'));
    const indexOf = (slug: string) => body.findIndex((c) => c.slug === slug);

    expect(indexOf('sql-window-function-ranking-and-navigation')).toBeLessThan(
      indexOf('sql-pagination-top-n-and-extremes-per-group'),
    );
    expect(indexOf('sql-window-function-ranking-and-navigation')).toBeLessThan(
      indexOf('sql-running-totals-and-moving-aggregates'),
    );
    expect(indexOf('sql-running-totals-and-moving-aggregates')).toBeLessThan(
      indexOf('sql-moving-window-aggregations'),
    );
    expect(indexOf('sql-window-function-ranking-and-navigation')).toBeLessThan(
      indexOf('sql-differences-between-adjacent-rows'),
    );
    expect(indexOf('sql-differences-between-adjacent-rows')).toBeLessThan(
      indexOf('sql-gaps-and-islands'),
    );
    expect(indexOf('sql-hierarchical-parent-child-relationships')).toBeLessThan(
      indexOf('sql-recursive-hierarchy-queries'),
    );
    expect(indexOf('sql-pivoting-rows-to-columns')).toBeLessThan(
      indexOf('sql-unpivoting-columns-to-rows'),
    );
    expect(indexOf('sql-string-parsing-and-validation')).toBeLessThan(
      indexOf('sql-delimited-data-and-lists'),
    );
    expect(indexOf('sql-string-parsing-and-validation')).toBeLessThan(
      indexOf('sql-regex-pattern-matching-in-sql'),
    );
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
