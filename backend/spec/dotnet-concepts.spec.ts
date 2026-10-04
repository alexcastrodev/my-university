import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

describe('GET /dotnet-concepts', () => {
  it('returns a list of concept summaries', async () => {
    const res = await get('/dotnet-concepts');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('summaries expose slug, id, title, topic, summary and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get('/dotnet-concepts'));
    const concept = body.find(
      (c) => c.slug === 'modular-monolith-module-boundaries',
    );
    expect(concept).toMatchObject({
      slug: 'modular-monolith-module-boundaries',
      id: 1,
      title: expect.any(String),
      topic: 'Modular Architecture',
      summary: expect.any(String),
      publishedAt: expect.any(String),
    });
    expect(concept.sections).toBeUndefined();
  });

  it('lists a prerequisite before the concepts that require it', async () => {
    const body = await json<any[]>(await get('/dotnet-concepts'));
    const indexOf = (slug: string) => body.findIndex((c) => c.slug === slug);
    expect(indexOf('loading-related-data-and-n-plus-one')).toBeGreaterThan(-1);
    expect(indexOf('dbcontext-lifetime-and-change-tracking')).toBeLessThan(
      indexOf('loading-related-data-and-n-plus-one'),
    );
    expect(indexOf('ef-core-migrations-workflow')).toBeLessThan(
      indexOf('applying-migrations-in-production'),
    );
  });
});

describe('GET /dotnet-concepts/:slug', () => {
  it('returns the full concept for a known slug', async () => {
    const res = await get(
      '/dotnet-concepts/modular-monolith-module-boundaries',
    );
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('modular-monolith-module-boundaries');
    expect(body.version).toBe('1.0');
    expect(body.updatedAt).toBe('2026-10-04');
  });

  it('splits the markdown body into the fixed concept sections', async () => {
    const body = await json<any>(
      await get('/dotnet-concepts/modular-monolith-module-boundaries'),
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
      await get('/dotnet-concepts/modular-monolith-module-boundaries'),
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

  it('serves the pt-BR translation when asked', async () => {
    const body = await json<any>(
      await get(
        '/dotnet-concepts/modular-monolith-module-boundaries?lang=pt-BR',
      ),
    );
    expect(body.language).toBe('pt-BR');
    expect(body.availableLanguages).toEqual(
      expect.arrayContaining(['en', 'pt-BR']),
    );
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await get('/dotnet-concepts/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/dotnet-concepts/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});

describe('PUT /dotnet-concepts/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`dotnet-concept-404-${Date.now()}`);
    const res = await put(
      '/dotnet-concepts/does-not-exist/read',
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put(
      '/dotnet-concepts/modular-monolith-module-boundaries/read',
      {},
      {},
    );
    expect(res.status).toBe(401);
  });

  it('grants XP once and is idempotent on repeated calls', async () => {
    const { cookie } = await login(`dotnet-concept-read-${Date.now()}`);
    const before = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;

    const res1 = await put(
      '/dotnet-concepts/modular-monolith-module-boundaries/read',
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
      '/dotnet-concepts/modular-monolith-module-boundaries/read',
      {},
      { Cookie: cookie },
    );
    const afterSecond = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterSecond).toBe(afterFirst);
  });
});
