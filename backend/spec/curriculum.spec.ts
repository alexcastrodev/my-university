import { describe, it, expect } from 'vitest';
import { get, json, login, put } from './helpers';

const MOD = 'foundations';
const DISCIPLINE = 'programming-computational-thinking';
const BASE_PATH = `/curriculum/${MOD}/${DISCIPLINE}`;

describe('GET /curriculum/:module/:discipline', () => {
  it('returns a list of concept summaries', async () => {
    const res = await get(BASE_PATH);
    expect(res.status).toBe(200);
    const body = await json<any[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(23);
  });

  it('summaries expose slug, id, title, summary and publishedAt but no sections', async () => {
    const body = await json<any[]>(await get(BASE_PATH));
    const concept = body.find((c) => c.slug === 'what-is-computation');
    expect(concept).toMatchObject({
      slug: 'what-is-computation',
      id: 1,
      title: expect.any(String),
      summary: expect.any(String),
      publishedAt: expect.any(String),
    });
    expect(concept.sections).toBeUndefined();
  });

  it('never places a concept before something it requires', async () => {
    const body = await json<any[]>(await get(BASE_PATH));
    const indexOf = (slug: string) => body.findIndex((c) => c.slug === slug);

    expect(indexOf('what-is-computation')).toBeLessThan(
      indexOf('problem-decomposition-and-algorithmic-thinking'),
    );
    expect(indexOf('variables-and-primitive-types')).toBeLessThan(
      indexOf('expressions-and-assignment'),
    );
    expect(indexOf('expressions-and-assignment')).toBeLessThan(
      indexOf('conditional-control-flow'),
    );
    expect(indexOf('conditional-control-flow')).toBeLessThan(
      indexOf('iteration-and-loops'),
    );
    expect(indexOf('iteration-and-loops')).toBeLessThan(
      indexOf('lists-and-mutability'),
    );
    expect(indexOf('decomposition-and-abstraction-via-functions')).toBeLessThan(
      indexOf('recursion'),
    );
    expect(indexOf('recursion')).toBeLessThan(
      indexOf('recursion-on-structural-data'),
    );
    expect(indexOf('lists-and-mutability')).toBeLessThan(
      indexOf('recursion-on-structural-data'),
    );
    expect(indexOf('timing-and-counting-operations')).toBeLessThan(
      indexOf('big-o-and-asymptotic-complexity'),
    );
    expect(indexOf('big-o-and-asymptotic-complexity')).toBeLessThan(
      indexOf('sorting-algorithms-intro'),
    );
    expect(indexOf('testing-and-debugging')).toBeLessThan(
      indexOf('exceptions-and-assertions'),
    );
  });

  it('returns 404 for an unknown discipline', async () => {
    const res = await get(`/curriculum/${MOD}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal discipline', async () => {
    const res = await get(`/curriculum/${MOD}/..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal module', async () => {
    const res = await get(`/curriculum/..%2f..%2fetc%2fpasswd/${DISCIPLINE}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /curriculum/:module/:discipline/:slug', () => {
  it('returns the full concept for a known slug', async () => {
    const res = await get(`${BASE_PATH}/recursion`);
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.slug).toBe('recursion');
    expect(body.version).toBe('1.0');
    expect(body.updatedAt).toBe('2026-09-06');
  });

  it('splits the markdown body into the fixed concept sections', async () => {
    const body = await json<any>(await get(`${BASE_PATH}/recursion`));
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
    const body = await json<any>(await get(`${BASE_PATH}/recursion`));
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
    const res = await get(`${BASE_PATH}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a path-traversal slug', async () => {
    const res = await get(`${BASE_PATH}/..%2f..%2fetc%2fpasswd`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /curriculum/:module/:discipline/:slug/read', () => {
  it('returns 404 for an unknown slug', async () => {
    const { cookie } = await login(`curriculum-404-${Date.now()}`);
    const res = await put(
      `${BASE_PATH}/does-not-exist/read`,
      {},
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when no session cookie is present', async () => {
    const res = await put(`${BASE_PATH}/recursion/read`, {}, {});
    expect(res.status).toBe(401);
  });

  it('grants XP once and is idempotent on repeated calls', async () => {
    const { cookie } = await login(`curriculum-read-${Date.now()}`);
    const before = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;

    const res1 = await put(
      `${BASE_PATH}/recursion/read`,
      {},
      { Cookie: cookie },
    );
    expect(res1.status).toBe(200);
    expect((await json<any>(res1)).read).toBe(true);

    const afterFirst = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterFirst).toBe(before + 10);

    await put(`${BASE_PATH}/recursion/read`, {}, { Cookie: cookie });
    const afterSecond = (
      await json<{ total: number }>(await get('/xp', { Cookie: cookie }))
    ).total;
    expect(afterSecond).toBe(afterFirst);
  });
});
