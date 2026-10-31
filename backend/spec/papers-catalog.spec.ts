import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { json } from './helpers';
import { CatalogApp, startCatalogApp } from './papers-catalog-app';

// Requests to the real PapersController (spec/papers-catalog-app.ts) backed by the real Postgres; each
// test sends a request and asserts on the response. Every title, DOI, keyword and area carries a
// per-run token, so a test only ever sees its own papers and never meets leftovers of an interrupted run.
const run = Math.random().toString(36).slice(2, 8);
const doi = (n: string) => `10.5555/${run}.${n}`;
const title = (n: string) => `Catalog paper ${run} ${n}`;
const area = (n: string) => `Area ${run} ${n}`;

interface Summary {
  id: string;
  title: string;
  authors: string[];
  keywords: string[];
  venue: string | null;
  publicationDate: string | null;
  doi: string | null;
  url: string | null;
  researchArea: string | null;
  type: string;
  stage: string;
  excerpt: string | null;
}
interface Page {
  items: Summary[];
  total: number;
  page: number;
  limit: number;
}

let app: CatalogApp;
const created = new Set<string>();
/** A well-formed public id that no paper has. */
const UNKNOWN_ID = '01a191ed-2e04-7235-ae86-8483c518560e';
/** A UUID of version 7: what PostgreSQL's uuidv7() makes. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const devAuth = process.env.ENABLE_DEV_AUTH;

const send = (method: string, path: string, data?: unknown) =>
  fetch(`${app.url}${path}`, {
    method,
    // Fastify rejects a JSON content type on a request with no body.
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

let doiCounter = 0;

/**
 * Seeds through the same dev-only route the browser tests use. A paper needs a DOI, a date or an author
 * to be told apart from others (#178), so one that has none of them gets a DOI of its own.
 */
async function seed(data: Record<string, unknown>): Promise<string> {
  const body =
    data.doi || data.publicationDate || data.authors
      ? data
      : { ...data, doi: doi(`auto${doiCounter++}`) };
  const res = await send('POST', '/papers/_test', body);
  expect(res.status, await res.clone().text()).toBe(201);
  const { paper } = await json<{ paper: { id: string } }>(res);
  created.add(paper.id);
  return paper.id;
}

const list = async (query: string) => {
  const res = await fetch(`${app.url}/papers?${query}`);
  return { res, page: await json<Page>(res) };
};
/** Titles of everything of this run that the query returns, in order. */
const titles = async (query: string) =>
  (await list(`q=${run}&${query}`)).page.items.map((i) => i.title);

beforeAll(async () => {
  process.env.ENABLE_DEV_AUTH = '1';
  app = await startCatalogApp();
});
afterEach(async () => {
  await Promise.all(
    [...created].map((id) => send('DELETE', `/papers/_test/${id}`)),
  );
  created.clear();
});
afterAll(async () => {
  if (devAuth === undefined) delete process.env.ENABLE_DEV_AUTH;
  else process.env.ENABLE_DEV_AUTH = devAuth;
  await app.close();
});

describe('GET /papers', () => {
  it('lists the public metadata of a paper, with its authors in order and its keywords', async () => {
    const id = await seed({
      title: title('full'),
      abstract: 'We study the catalog.',
      doi: doi('full'),
      venue: 'Journal of Specs',
      publicationDate: '2024-05',
      url: 'https://example.org/full',
      researchArea: area('x'),
      type: 'journal-article',
      authors: [{ name: 'Ada Lovelace' }, { name: 'Hopper, Grace' }],
      keywords: ['Zeta', 'alpha'],
    });

    const { res, page } = await list(`q=${run}`);

    expect(res.status).toBe(200);
    expect(page).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(page.items[0]).toEqual({
      id,
      title: title('full'),
      authors: ['Ada Lovelace', 'Hopper, Grace'],
      keywords: ['alpha', 'zeta'],
      venue: 'Journal of Specs',
      publicationDate: '2024-05',
      doi: doi('full'),
      url: 'https://example.org/full',
      researchArea: area('x'),
      type: 'journal-article',
      stage: 'published',
      excerpt: 'We study the catalog.',
    });
  });

  it('returns an empty page, not an error, when nothing matches', async () => {
    const { res, page } = await list(`q=${run}-nothing-like-this`);
    expect(res.status).toBe(200);
    expect(page).toMatchObject({ items: [], total: 0 });
  });

  it('shows a paper with nothing but a title as nulls and empty lists', async () => {
    await seed({ title: title('bare') });
    const { page } = await list(`q=${run}`);
    expect(page.items[0]).toMatchObject({
      authors: [],
      keywords: [],
      venue: null,
      publicationDate: null,
      doi: expect.stringContaining(run),
      researchArea: null,
      type: 'other',
      excerpt: null,
    });
  });

  it('cuts a long abstract at a word boundary', async () => {
    await seed({ title: title('long'), abstract: 'lorem '.repeat(200) });
    const { excerpt } = (await list(`q=${run}`)).page.items[0];
    expect(excerpt!.endsWith('…')).toBe(true);
    expect(excerpt!.length).toBeLessThanOrEqual(281);
    expect(excerpt).not.toMatch(/lore…$/);
  });

  describe('search and filters', () => {
    it('finds by title, abstract, author, keyword and DOI with the free-text query', async () => {
      await seed({ title: title('by-title') });
      await seed({
        title: title('plain-a'),
        abstract: `mentions needle${run}`,
      });
      await seed({
        title: title('plain-b'),
        authors: [{ name: `Needleson${run}` }],
      });
      await seed({ title: title('plain-c'), keywords: [`kw${run}needle`] });
      await seed({ title: title('plain-d'), doi: doi('needle') });

      expect((await list(`q=${title('by-title')}`)).page.total).toBe(1);
      expect(
        (await list(`q=needle${run}`)).page.items.map((i) => i.title),
      ).toEqual([title('plain-a')]);
      expect((await list(`q=needleson${run}`)).page.items[0].title).toBe(
        title('plain-b'),
      );
      expect((await list(`q=kw${run}needle`)).page.items[0].title).toBe(
        title('plain-c'),
      );
      expect((await list(`q=${doi('needle')}`)).page.items[0].title).toBe(
        title('plain-d'),
      );
    });

    it('filters by author, case-insensitively and on any position', async () => {
      await seed({
        title: title('a1'),
        authors: [{ name: 'First Person' }, { name: `Turing${run}, Alan` }],
      });
      await seed({ title: title('a2'), authors: [{ name: 'Someone Else' }] });
      expect(await titles(`author=turing${run}`)).toEqual([title('a1')]);
    });

    it('filters by DOI in any spelling, and by a fragment of one', async () => {
      await seed({ title: title('d1'), doi: doi('one') });
      await seed({ title: title('d2'), doi: doi('two') });
      expect(
        await titles(
          `doi=${encodeURIComponent(`https://doi.org/${doi('one').toUpperCase()}`)}`,
        ),
      ).toEqual([title('d1')]);
      expect(
        await titles(`doi=${encodeURIComponent(`doi:${doi('two')}`)}`),
      ).toEqual([title('d2')]);
      expect(
        (await titles(`doi=${encodeURIComponent(`${run}.`)}`)).sort(),
      ).toEqual([title('d1'), title('d2')]);
    });

    it('filters by a whole keyword, ignoring case, not by a piece of one', async () => {
      await seed({ title: title('k1'), keywords: [`Raft${run}`, 'consensus'] });
      await seed({ title: title('k2'), keywords: [`raftish${run}`] });
      expect(await titles(`keyword=RAFT${run}`)).toEqual([title('k1')]);
      expect(await titles(`keyword=raft`)).toEqual([]);
    });

    it('filters by research area, publication type and year', async () => {
      await seed({
        title: title('f1'),
        researchArea: area('a'),
        type: 'preprint',
        publicationDate: '2021-03-01',
      });
      await seed({
        title: title('f2'),
        researchArea: area('a'),
        type: 'book',
        publicationDate: '2022',
      });
      await seed({
        title: title('f3'),
        researchArea: area('b'),
        type: 'preprint',
        publicationDate: '2021',
      });

      expect(
        (
          await titles(`area=${encodeURIComponent(area('a').toUpperCase())}`)
        ).sort(),
      ).toEqual([title('f1'), title('f2')]);
      expect((await titles('type=preprint')).sort()).toEqual([
        title('f1'),
        title('f3'),
      ]);
      expect((await titles('year=2021')).sort()).toEqual([
        title('f1'),
        title('f3'),
      ]);
    });

    it('filters by publication stage, which groups the types that stand alike', async () => {
      await seed({ title: title('s1'), type: 'journal-article' });
      await seed({ title: title('s2'), type: 'conference-paper' });
      await seed({ title: title('s3'), type: 'preprint' });
      await seed({ title: title('s4'), type: 'thesis' });

      expect((await titles('stage=published')).sort()).toEqual([
        title('s1'),
        title('s2'),
      ]);
      expect(await titles('stage=preprint')).toEqual([title('s3')]);
      expect(await titles('stage=thesis')).toEqual([title('s4')]);
      expect(await titles('stage=published&type=preprint')).toEqual([]);
    });

    it('combines filters with AND', async () => {
      await seed({
        title: title('c1'),
        researchArea: area('a'),
        type: 'preprint',
        publicationDate: '2021',
      });
      await seed({
        title: title('c2'),
        researchArea: area('a'),
        type: 'book',
        publicationDate: '2021',
      });
      expect(
        await titles(
          `area=${encodeURIComponent(area('a'))}&type=preprint&year=2021`,
        ),
      ).toEqual([title('c1')]);
    });

    it('treats % and _ in the query as the characters, not as wildcards', async () => {
      await seed({ title: title('50% sure') });
      await seed({ title: title('plain') });
      expect(
        (await list(`q=${encodeURIComponent(`${run} 50%`)}`)).page.items.map(
          (i) => i.title,
        ),
      ).toEqual([title('50% sure')]);
      expect(
        (await list(`q=${encodeURIComponent(`%${run}`)}`)).page.total,
      ).toBe(0);
      expect(
        (await list(`q=${encodeURIComponent(`${run}_plain`)}`)).page.total,
      ).toBe(0);
    });

    it('ignores empty filters', async () => {
      await seed({ title: title('e1') });
      const { res, page } = await list(
        `q=${run}&author=&keyword=&area=&type=&year=&sort=`,
      );
      expect(res.status).toBe(200);
      expect(page.total).toBe(1);
    });
  });

  describe('ordering and pagination', () => {
    it('puts the most recent first and the undated last, then by title when asked', async () => {
      await seed({ title: title('b-old'), publicationDate: '2001' });
      await seed({ title: title('c-new'), publicationDate: '2023-06' });
      await seed({ title: title('a-undated') });
      expect(await titles('')).toEqual([
        title('c-new'),
        title('b-old'),
        title('a-undated'),
      ]);
      expect(await titles('sort=title')).toEqual([
        title('a-undated'),
        title('b-old'),
        title('c-new'),
      ]);
    });

    it('pages without repeating or skipping, and reports the total', async () => {
      for (const n of ['1', '2', '3', '4', '5']) {
        await seed({ title: title(`p${n}`), publicationDate: `200${n}` });
      }
      const first = (await list(`q=${run}&limit=2&page=1`)).page;
      const second = (await list(`q=${run}&limit=2&page=2`)).page;
      const third = (await list(`q=${run}&limit=2&page=3`)).page;
      const beyond = (await list(`q=${run}&limit=2&page=4`)).page;

      expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
      expect([first, second, third].map((p) => p.items.length)).toEqual([
        2, 2, 1,
      ]);
      expect(
        [...first.items, ...second.items, ...third.items].map((i) => i.title),
      ).toEqual(['5', '4', '3', '2', '1'].map((n) => title(`p${n}`)));
      expect(beyond).toMatchObject({ items: [], total: 5, page: 4, limit: 2 });
    });
  });

  describe('validation', () => {
    it.each([
      ['an unknown publication type', 'type=zine'],
      ['an unknown publication stage', 'stage=peer-reviewed'],
      ['an unknown sort', 'sort=random'],
      ['a page below 1', 'page=0'],
      ['a page above the cap', 'page=1001'],
      ['a non-numeric page', 'page=abc'],
      ['a limit below 1', 'limit=0'],
      ['a limit above the cap', 'limit=51'],
      ['a year that is not four digits', 'year=99'],
      ['a text query over 200 characters', `q=${'x'.repeat(201)}`],
      ['an unknown parameter', 'unknown=1'],
    ])('rejects %s with a 400', async (_name, query) => {
      const res = await fetch(`${app.url}/papers?${query}`);
      expect(res.status).toBe(400);
    });
  });
});

describe('publication stage (#201)', () => {
  const expected: Record<string, string> = {
    'journal-article': 'published',
    'conference-paper': 'published',
    'book-chapter': 'published',
    book: 'published',
    preprint: 'preprint',
    thesis: 'thesis',
    report: 'report',
    other: 'unknown',
  };

  it('says where every kind of paper stands, in the list and in the full record', async () => {
    const ids = new Map<string, string>();
    for (const type of Object.keys(expected)) {
      ids.set(type, await seed({ title: title(`kind ${type}`), type }));
    }

    const page = await json<Page>(
      await send('GET', `/papers?q=${encodeURIComponent(title('kind '))}&limit=50`),
    );
    expect(page.total).toBe(Object.keys(expected).length);
    for (const [type, stage] of Object.entries(expected)) {
      const id = ids.get(type);
      expect(page.items.find((p) => p.id === id)?.stage, type).toBe(stage);
      const detail = await json<{ stage: string }>(
        await send('GET', `/papers/${id}`),
      );
      expect(detail.stage, type).toBe(stage);
    }
  });

  it('calls a paper whose kind is not known unknown, not published', async () => {
    const id = await seed({ title: title('no kind') });
    const detail = await json<{ type: string; stage: string }>(
      await send('GET', `/papers/${id}`),
    );
    expect(detail).toMatchObject({ type: 'other', stage: 'unknown' });
  });
});

describe('GET /papers/facets', () => {
  it('counts the research areas and types in the catalog, most used first', async () => {
    await seed({
      title: title('x1'),
      researchArea: area('big'),
      type: 'thesis',
    });
    await seed({
      title: title('x2'),
      researchArea: area('big'),
      type: 'thesis',
    });
    await seed({
      title: title('x3'),
      researchArea: area('small'),
      type: 'thesis',
    });

    const res = await fetch(`${app.url}/papers/facets`);
    const facets = await json<{
      areas: { value: string; count: number }[];
      types: { value: string; count: number }[];
    }>(res);

    expect(res.status).toBe(200);
    const mine = facets.areas.filter((a) => a.value.includes(run));
    expect(mine).toEqual([
      { value: area('big'), count: 2 },
      { value: area('small'), count: 1 },
    ]);
    expect(
      facets.types.find((t) => t.value === 'thesis')!.count,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('GET /papers/:id', () => {
  it('returns the full public record and nothing about where it came from', async () => {
    const id = await seed({
      title: title('detail'),
      abstract: 'The abstract.',
      doi: doi('detail'),
      venue: 'Venue',
      publicationDate: '2020',
      url: 'https://example.org/detail',
      researchArea: area('d'),
      type: 'conference-paper',
      authors: [{ name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' }],
      keywords: ['one'],
    });

    const res = await fetch(`${app.url}/papers/${id}`);
    const body = await json<Record<string, unknown>>(res);

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id,
      title: title('detail'),
      abstract: 'The abstract.',
      doi: doi('detail'),
      venue: 'Venue',
      publicationDate: '2020',
      url: 'https://example.org/detail',
      researchArea: area('d'),
      type: 'conference-paper',
      stage: 'published',
      authors: [{ name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' }],
      keywords: ['one'],
    });
    expect(Object.keys(body)).not.toContain('sources');
    expect(Object.keys(body)).not.toContain('fingerprint');
  });

  it('answers 404 for a paper that does not exist and for anything that is not a public id', async () => {
    for (const id of [UNKNOWN_ID, '99999999999', 'not-an-id', '0']) {
      expect((await fetch(`${app.url}/papers/${id}`)).status, id).toBe(404);
    }
  });

  it('is addressed by a UUIDv7, in either letter case, and carries it as its id', async () => {
    const id = await seed({ title: title('uuid') });
    expect(id).toMatch(UUID_V7);

    for (const spelling of [id, id.toUpperCase()]) {
      const res = await fetch(`${app.url}/papers/${spelling}`);
      expect(res.status).toBe(200);
      expect((await json<{ id: string }>(res)).id).toBe(id);
    }
    const { page } = await list(`q=${title('uuid')}`);
    expect(page.items.map((i) => i.id)).toEqual([id]);
  });

  it('never shows the integer key: not in the record, the list, or the analysis', async () => {
    const id = await seed({ title: title('hidden-key') });
    const [row]: { id: number }[] = await app.dataSource.query(
      `SELECT id FROM paper WHERE "publicId" = $1`,
      [id],
    );
    const bodies = await Promise.all([
      fetch(`${app.url}/papers/${id}`).then((r) => r.text()),
      fetch(`${app.url}/papers/${id}/analysis`).then((r) => r.text()),
      fetch(`${app.url}/papers?q=${title('hidden-key')}`).then((r) => r.text()),
    ]);
    for (const body of bodies) {
      expect(body).not.toMatch(new RegExp(`"(id|paperId)":\\s*${row.id}\\b`));
    }
  });

  it('answers the id a paper used to have with a permanent redirect to its public id', async () => {
    const id = await seed({ title: title('legacy') });
    const [row]: { id: number }[] = await app.dataSource.query(
      `SELECT id FROM paper WHERE "publicId" = $1`,
      [id],
    );

    const res = await fetch(`${app.url}/papers/${row.id}`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`/api/papers/${id}`);
    expect(await res.text()).not.toContain(String(row.id));

    // Followed, it lands on the record; an integer nobody had is a plain 404.
    const followed = await fetch(`${app.url}/papers/${row.id}`);
    expect(followed.status).toBe(200);
    expect((await json<{ id: string }>(followed)).id).toBe(id);
    expect((await fetch(`${app.url}/papers/2147483000`)).status).toBe(404);
  });

  it('does not need a session: nothing in the response depends on the viewer', async () => {
    const id = await seed({ title: title('anon') });
    const res = await fetch(`${app.url}/papers/${id}`, {
      headers: { Cookie: 'uid=1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('dev-only seeding routes', () => {
  it('do not exist unless dev auth is on', async () => {
    delete process.env.ENABLE_DEV_AUTH;
    try {
      expect(
        (await send('POST', '/papers/_test', { title: title('no') })).status,
      ).toBe(404);
      expect((await send('DELETE', '/papers/_test/1')).status).toBe(404);
    } finally {
      process.env.ENABLE_DEV_AUTH = '1';
    }
  });

  it('refuse an invalid paper', async () => {
    const res = await send('POST', '/papers/_test', { title: '   ' });
    expect(res.status).toBe(400);
  });
});
