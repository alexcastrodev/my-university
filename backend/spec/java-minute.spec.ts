import { describe, it, expect } from 'vitest';
import { get, json } from './helpers';

describe('GET /java-minute', () => {
  it('returns a list of episode summaries', async () => {
    const res = await get('/java-minute');
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('summaries expose slug, id, question and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get('/java-minute'));
    const episode = body.find((e) => e.slug === 'context-switching');
    expect(episode).toMatchObject({
      slug: 'context-switching',
      id: 1,
      question: expect.any(String),
      publishedAt: expect.any(String),
    });
    expect(episode.sections).toBeUndefined();
  });

  it('is ordered by id, highest first', async () => {
    const body = await json<any[]>(await get('/java-minute'));
    const ids = body.map((e) => e.id);
    const sorted = [...ids].sort((a, b) => b - a);
    expect(ids).toEqual(sorted);
  });
});

describe('GET /java-minute/:slug', () => {
  it('returns the full episode for a known slug', async () => {
    const res = await get('/java-minute/context-switching');
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('context-switching');
    expect(body.version).toBe('1.0');
    expect(body.updatedAt).toBe('2026-07-20');
  });

  it('splits the markdown body into 8 sections', async () => {
    const body = await json<any>(await get('/java-minute/context-switching'));
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections).toHaveLength(8);
    expect(body.sections.map((s: any) => s.title)).toEqual([
      'Question',
      'Short Answer',
      'What It Is',
      'The Process',
      'Performance Impact',
      'Practical Example',
      'Solution and Conclusion',
      'References',
    ]);
  });

  it('includes structured references with label, url and type', async () => {
    const body = await json<any>(await get('/java-minute/context-switching'));
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
    const res = await get('/java-minute/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get('/java-minute/..%2f..%2fetc%2fpasswd');
    expect(res.status).toBe(404);
  });
});
