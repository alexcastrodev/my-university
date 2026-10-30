import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { get, json, login, put } from './helpers';

interface ConceptMeta {
  slug: string;
  id: number;
  topic: string;
}

// Read at test time so the spec follows whatever the track holds, including nothing yet.
const concepts: ConceptMeta[] = JSON.parse(
  readFileSync(
    join(__dirname, '../src/seed/data/dotnet-ai-concepts/concepts.json'),
    'utf-8',
  ),
);
const first = concepts[0];

describe('GET /dotnet-ai-concepts', () => {
  it('returns a list with one summary per concept in concepts.json', async () => {
    const res = await get('/dotnet-ai-concepts');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((c) => c.slug).sort()).toEqual(
      concepts.map((c) => c.slug).sort(),
    );
  });

  it('summaries expose slug, id, title, topic, summary and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get('/dotnet-ai-concepts'));
    for (const meta of concepts) {
      const concept = body.find((c) => c.slug === meta.slug);
      expect(concept).toMatchObject({
        slug: meta.slug,
        id: meta.id,
        title: expect.any(String),
        topic: meta.topic,
        summary: expect.any(String),
        publishedAt: expect.any(String),
      });
      expect(concept.sections).toBeUndefined();
    }
  });

  it('splits every markdown body into the fixed concept sections', async () => {
    for (const { slug } of concepts) {
      const body = await json<any>(await get(`/dotnet-ai-concepts/${slug}`));
      expect(Array.isArray(body.sections)).toBe(true);
      expect(body.sections.map((s: any) => s.title)).toEqual([
        'Objective',
        'Use Cases',
        'Deep Dive',
        'Trade-offs',
        'Documentation Links',
      ]);
    }
  });

  it('keeps the Lab section out of the concept sections, in both languages', async () => {
    for (const lang of ['en', 'pt-BR']) {
      for (const { slug } of concepts) {
        const body = await json<any>(
          await get(`/dotnet-ai-concepts/${slug}?lang=${lang}`),
        );
        expect(body.sections.map((s: any) => s.title)).not.toContain('Lab');
      }
    }
  });

  it('includes structured references with label, url and type', async () => {
    for (const { slug } of concepts) {
      const body = await json<any>(await get(`/dotnet-ai-concepts/${slug}`));
      expect(body.references.length).toBeGreaterThan(0);
      for (const ref of body.references) {
        expect(ref).toMatchObject({
          label: expect.any(String),
          url: expect.any(String),
          type: expect.stringMatching(/^(video|doc)$/),
        });
      }
    }
  });

  it('serves the pt-BR translation whenever the concept has one', async () => {
    for (const { slug } of concepts) {
      const en = await json<any>(await get(`/dotnet-ai-concepts/${slug}`));
      const body = await json<any>(
        await get(`/dotnet-ai-concepts/${slug}?lang=pt-BR`),
      );
      expect(body.availableLanguages).toEqual(en.availableLanguages);
      expect(body.language).toBe(
        en.availableLanguages.includes('pt-BR') ? 'pt-BR' : 'en',
      );
    }
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await get('/dotnet-ai-concepts/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/dotnet-ai-concepts/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});

describe('PUT /dotnet-ai-concepts/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`dotnet-ai-concept-404-${Date.now()}`);
    const res = await put(
      '/dotnet-ai-concepts/does-not-exist/read',
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put('/dotnet-ai-concepts/does-not-exist/read', {}, {});
    expect(res.status).toBe(401);
  });

  it.skipIf(!first)(
    'grants XP once and is idempotent on repeated calls',
    async () => {
      const path = `/dotnet-ai-concepts/${first.slug}/read`;
      const { cookie } = await login(`dotnet-ai-concept-read-${Date.now()}`);
      const before = (
        await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
      ).total;

      const res1 = await put(path, {}, { Cookie: cookie });
      expect(res1.status).toBe(200);
      expect((await json<any>(res1)).read).toBe(true);

      const afterFirst = (
        await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
      ).total;
      expect(afterFirst).toBe(before + 10);

      await put(path, {}, { Cookie: cookie });
      const afterSecond = (
        await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
      ).total;
      expect(afterSecond).toBe(afterFirst);
    },
  );
});
