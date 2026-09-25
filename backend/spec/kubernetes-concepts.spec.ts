import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

describe('GET /kubernetes-concepts', () => {
  it('returns a list of concept summaries', async () => {
    const res = await get('/kubernetes-concepts');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('summaries expose slug, id, category, title, summary and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get('/kubernetes-concepts'));
    const concept = body.find(
      (c) => c.slug === 'kubernetes-secrets-fundamentals',
    );
    expect(concept).toMatchObject({
      slug: 'kubernetes-secrets-fundamentals',
      id: 1,
      category: 'Secrets & Configuration',
      title: expect.any(String),
      summary: expect.any(String),
      publishedAt: expect.any(String),
    });
    expect(concept.sections).toBeUndefined();
  });

  it('lists a prerequisite before the concepts that require it', async () => {
    const body = await json<any[]>(await get('/kubernetes-concepts'));
    const slugs = body.map((c) => c.slug);
    expect(slugs[0]).toBe('kubernetes-secrets-fundamentals');
    expect(slugs).toContain('projected-volumes-combining-multiple-secrets');
  });

  it('exposes the lab link on the projected volumes concept', async () => {
    const body = await json<any[]>(await get('/kubernetes-concepts'));
    const concept = body.find((c) => c.slug === 'projected-volumes-combining-multiple-secrets');
    expect(concept.labUrl).toContain('kubernetes-concepts/projected-volumes-combining-multiple-secrets');
  });
});

describe('GET /kubernetes-concepts/:slug', () => {
  it('returns the full concept for a known slug', async () => {
    const res = await get('/kubernetes-concepts/kubernetes-secrets-fundamentals');
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('kubernetes-secrets-fundamentals');
    expect(body.category).toBe('Secrets & Configuration');
    expect(body.version).toBe('1.0');
    expect(body.updatedAt).toBe('2026-09-25');
  });

  it('splits the markdown body into the fixed concept sections', async () => {
    const body = await json<any>(
      await get('/kubernetes-concepts/kubernetes-secrets-fundamentals'),
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
      await get('/kubernetes-concepts/kubernetes-secrets-fundamentals'),
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
    const body = await json<any>(await get('/kubernetes-concepts/kubernetes-secrets-fundamentals?lang=pt-BR'));
    expect(body.language).toBe('pt-BR');
    expect(body.title).toBe('Fundamentos de Secrets no Kubernetes');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await get('/kubernetes-concepts/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/kubernetes-concepts/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});

describe('PUT /kubernetes-concepts/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`kubernetes-concept-404-${Date.now()}`);
    const res = await put(
      '/kubernetes-concepts/does-not-exist/read',
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put(
      '/kubernetes-concepts/kubernetes-secrets-fundamentals/read',
      {},
      {},
    );
    expect(res.status).toBe(401);
  });

  it('grants XP once and is idempotent on repeated calls', async () => {
    const { cookie } = await login(`kubernetes-concept-read-${Date.now()}`);
    const before = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;

    const res1 = await put(
      '/kubernetes-concepts/kubernetes-secrets-fundamentals/read',
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
      '/kubernetes-concepts/kubernetes-secrets-fundamentals/read',
      {},
      { Cookie: cookie },
    );
    const afterSecond = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterSecond).toBe(afterFirst);
  });
});
