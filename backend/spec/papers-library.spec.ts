import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE, del, get, json, login, post } from './helpers';

/**
 * Live stack, like papers-discussion.spec: every call is a real request and every assertion is on the
 * response. The library is private, so most of this file is about who can and cannot reach what.
 */
const run = Math.random().toString(36).slice(2, 8);
const paperIds: string[] = [];
/** A well-formed public id that no paper has. */
const UNKNOWN_ID = '01a191ed-2e04-7235-ae86-8483c518560e';

const patch = (path: string, body: unknown, cookie?: string) =>
  fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

async function seed(title: string, extra: object = {}): Promise<string> {
  const res = await post('/papers/_test', {
    title: `${title} ${run}`,
    authors: [{ name: 'Ada Lovelace' }],
    publicationDate: '2020',
    ...extra,
  });
  expect(res.status).toBe(201);
  const id = (await json<{ paper: { id: string } }>(res)).paper.id;
  paperIds.push(id);
  return id;
}

const add = (cookie: string, paperId: string, status?: string) =>
  post('/paper-library', { paperId, status }, { Cookie: cookie });

const library = async (cookie: string, query = '') => {
  const res = await get(`/paper-library${query}`, { Cookie: cookie });
  expect(res.status).toBe(200);
  return json<{ items: any[]; total: number; page: number; limit: number }>(
    res,
  );
};

let first: string;
let second: string;
let third: string;

beforeAll(async () => {
  first = await seed('Attention Is All You Need', {
    researchArea: `nlp-${run}`,
    type: 'conference-paper',
  });
  second = await seed('Deep Residual Learning', {
    researchArea: `vision-${run}`,
    publicationDate: '2015',
  });
  third = await seed('Zebra Finches Sing', { type: 'journal-article' });
});
afterAll(async () => {
  for (const id of paperIds) await del(`/papers/_test/${id}`);
});

describe('who can use the library', () => {
  it.each([
    ['list', () => get('/paper-library')],
    ['facets', () => get('/paper-library/facets')],
    ['add', () => post('/paper-library', { paperId: first })],
    ['read one', () => get(`/paper-library/${first}`)],
    ['change one', () => patch(`/paper-library/${first}`, {})],
    ['remove one', () => del(`/paper-library/${first}`)],
  ])('answers 401 to %s without a session', async (_name, call) => {
    expect((await call()).status).toBe(401);
  });

  it('answers 401 to a forged session cookie', async () => {
    const res = await get('/paper-library', { Cookie: 'uid=1.forged' });
    expect(res.status).toBe(401);
  });
});

describe('adding a paper', () => {
  it('creates an entry with the defaults and does not duplicate the paper', async () => {
    const ana = await login(`lib-add-${run}`);
    const before = await json<any>(await get(`/papers/${first}`));

    const res = await add(ana.cookie, first);
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({
      paperId: first,
      status: 'to-read',
      rating: null,
      tags: [],
      completedAt: null,
    });

    const after = await json<any>(await get(`/papers/${first}`));
    expect(after).toEqual(before);
  });

  it('is idempotent: adding it again is a 200 and changes nothing', async () => {
    const ana = await login(`lib-twice-${run}`);
    await add(ana.cookie, first, 'reading');

    const again = await add(ana.cookie, first, 'to-read');
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ status: 'reading' });
    expect((await library(ana.cookie)).total).toBe(1);
  });

  it('works for a paper that has no PDF, which is every paper for now', async () => {
    const ana = await login(`lib-nopdf-${run}`);
    expect((await add(ana.cookie, third)).status).toBe(201);
  });

  it('lets a paper be added already read, dated today', async () => {
    const ana = await login(`lib-read-${run}`);
    const entry = await json<any>(await add(ana.cookie, first, 'read'));
    expect(entry.status).toBe('read');
    expect(entry.completedAt).toBe(new Date().toISOString().slice(0, 10));
  });

  it('answers 404 for a paper that does not exist', async () => {
    const ana = await login(`lib-ghost-${run}`);
    expect((await add(ana.cookie, UNKNOWN_ID)).status).toBe(404);
  });

  it.each([
    ['no paper id', {}],
    ['a text id', { paperId: 'abc' }],
    ['the integer id a paper had before public ids', { paperId: 3105 }],
    ['an unknown status', { paperId: UNKNOWN_ID, status: 'abandoned' }],
    ['an unknown field', { paperId: UNKNOWN_ID, userId: 2 }],
  ])('answers 400 for %s', async (_name, body) => {
    const ana = await login(`lib-bad-${run}`);
    const res = await post('/paper-library', body, { Cookie: ana.cookie });
    expect(res.status).toBe(400);
  });
});

describe('privacy between readers', () => {
  it('shows each reader only their own entries', async () => {
    const ana = await login(`lib-priv-a-${run}`);
    const bia = await login(`lib-priv-b-${run}`);
    await add(ana.cookie, first);

    expect((await library(ana.cookie)).total).toBe(1);
    expect((await library(bia.cookie)).total).toBe(0);
    expect(
      (await get(`/paper-library/${first}`, { Cookie: bia.cookie })).status,
    ).toBe(404);
  });

  it('does not let one reader change or remove the entry of another', async () => {
    const ana = await login(`lib-own-a-${run}`);
    const bia = await login(`lib-own-b-${run}`);
    await add(ana.cookie, first, 'reading');

    const changed = await patch(
      `/paper-library/${first}`,
      { status: 'read', rating: 1, tags: ['mine now'] },
      bia.cookie,
    );
    expect(changed.status).toBe(404);

    const removed = await del(`/paper-library/${first}`, {
      Cookie: bia.cookie,
    });
    expect(removed.status).toBe(204);

    const kept = await json<any>(
      await get(`/paper-library/${first}`, { Cookie: ana.cookie }),
    );
    expect(kept).toMatchObject({ status: 'reading', rating: null, tags: [] });
  });

  it('keeps tags and counts private as well', async () => {
    const ana = await login(`lib-tags-a-${run}`);
    const bia = await login(`lib-tags-b-${run}`);
    await add(ana.cookie, first);
    await patch(`/paper-library/${first}`, { tags: ['secret'] }, ana.cookie);

    const seen = await json<any>(
      await get('/paper-library/facets', { Cookie: bia.cookie }),
    );
    expect(seen).toMatchObject({ total: 0, tags: [] });
    expect((await library(bia.cookie, '?tag=secret')).total).toBe(0);
  });

  it('does not put a private library on the public paper page', async () => {
    const ana = await login(`lib-public-${run}`);
    await add(ana.cookie, first);
    await patch(
      `/paper-library/${first}`,
      { rating: 5, tags: ['only-me'] },
      ana.cookie,
    );

    const page = JSON.stringify(await json(await get(`/papers/${first}`)));
    expect(page).not.toContain('only-me');
    expect(page).not.toContain('library');
  });
});

describe('reading progress', () => {
  it('moves through the statuses and keeps the dates', async () => {
    const ana = await login(`lib-flow-${run}`);
    await add(ana.cookie, first);

    const reading = await json<any>(
      await patch(`/paper-library/${first}`, { status: 'reading' }, ana.cookie),
    );
    expect(reading).toMatchObject({ status: 'reading', completedAt: null });

    const done = await patch(
      `/paper-library/${first}`,
      { status: 'read' },
      ana.cookie,
    );
    expect(done.status).toBe(200);
    const finished = await json<any>(done);
    expect(finished.completedAt).toBe(new Date().toISOString().slice(0, 10));

    // What was written is what a later request reads back.
    const stored = await json<any>(
      await get(`/paper-library/${first}`, { Cookie: ana.cookie }),
    );
    expect(stored).toEqual(finished);
  });

  it('takes the finishing day the reader gives, and clears it when reading again', async () => {
    const ana = await login(`lib-date-${run}`);
    await add(ana.cookie, first);

    const dated = await json<any>(
      await patch(
        `/paper-library/${first}`,
        { status: 'read', completedAt: '2024-02-29' },
        ana.cookie,
      ),
    );
    expect(dated).toMatchObject({ status: 'read', completedAt: '2024-02-29' });

    const again = await json<any>(
      await patch(`/paper-library/${first}`, { status: 'reading' }, ana.cookie),
    );
    expect(again).toMatchObject({ status: 'reading', completedAt: null });
  });

  it('keeps the day when only the rating changes, and lets the day be cleared', async () => {
    const ana = await login(`lib-keep-${run}`);
    await add(ana.cookie, first);
    await patch(
      `/paper-library/${first}`,
      { status: 'read', completedAt: '2023-05-01' },
      ana.cookie,
    );

    const rated = await json<any>(
      await patch(`/paper-library/${first}`, { rating: 4 }, ana.cookie),
    );
    expect(rated).toMatchObject({ rating: 4, completedAt: '2023-05-01' });

    const cleared = await json<any>(
      await patch(
        `/paper-library/${first}`,
        { completedAt: null, rating: null },
        ana.cookie,
      ),
    );
    expect(cleared).toMatchObject({
      status: 'read',
      rating: null,
      completedAt: null,
    });
  });

  it.each([
    ['a finishing day on a paper not read yet', { completedAt: '2024-01-01' }],
    [
      'a day that does not exist',
      { status: 'read', completedAt: '2023-02-30' },
    ],
    ['a day in the future', { status: 'read', completedAt: '2999-01-01' }],
    ['a day in the wrong format', { status: 'read', completedAt: '1/2/2024' }],
    ['a rating of 0', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['a half-star rating', { rating: 3.5 }],
    ['an unknown status', { status: 'done' }],
    ['an unknown field', { paperId: 5 }],
    ['tags that are not a list', { tags: 'a,b' }],
    [
      'more than 20 tags',
      { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    ],
    ['a tag over 40 characters', { tags: ['x'.repeat(41)] }],
    ['a tag with a control character', { tags: ['a\u0000b'] }],
  ])('answers 400 for %s', async (_name, body) => {
    const ana = await login(`lib-400-${run}`);
    await add(ana.cookie, first);
    const res = await patch(`/paper-library/${first}`, body, ana.cookie);
    expect(res.status).toBe(400);
    expect(
      (
        await json<any>(
          await get(`/paper-library/${first}`, { Cookie: ana.cookie }),
        )
      ).status,
    ).toBe('to-read');
  });

  it('answers 404 when the paper is not in the library', async () => {
    const ana = await login(`lib-404-${run}`);
    expect(
      (await patch(`/paper-library/${first}`, { status: 'read' }, ana.cookie))
        .status,
    ).toBe(404);
    expect(
      (await get('/paper-library/2147483000', { Cookie: ana.cookie })).status,
    ).toBe(404);
    expect(
      (await get('/paper-library/99999999999', { Cookie: ana.cookie })).status,
    ).toBe(404);
  });
});

describe('tags', () => {
  it('stores them lowercase, trimmed and without repeats', async () => {
    const ana = await login(`lib-norm-${run}`);
    await add(ana.cookie, first);

    const entry = await json<any>(
      await patch(
        `/paper-library/${first}`,
        { tags: ['  Thesis  Chapter ', 'thesis chapter', 'ML', '', '   '] },
        ana.cookie,
      ),
    );
    expect(entry.tags).toEqual(['thesis chapter', 'ml']);
  });

  it('replaces the list on each change and can empty it', async () => {
    const ana = await login(`lib-repl-${run}`);
    await add(ana.cookie, first);
    await patch(`/paper-library/${first}`, { tags: ['a', 'b'] }, ana.cookie);
    const second = await json<any>(
      await patch(`/paper-library/${first}`, { tags: ['c'] }, ana.cookie),
    );
    expect(second.tags).toEqual(['c']);
    const none = await json<any>(
      await patch(`/paper-library/${first}`, { tags: [] }, ana.cookie),
    );
    expect(none.tags).toEqual([]);
  });

  it('counts them for the filter, most used first', async () => {
    const ana = await login(`lib-count-${run}`);
    for (const id of [first, second, third]) await add(ana.cookie, id);
    await patch(
      `/paper-library/${first}`,
      { tags: ['shared', 'solo'] },
      ana.cookie,
    );
    await patch(`/paper-library/${second}`, { tags: ['shared'] }, ana.cookie);

    const facets = await json<any>(
      await get('/paper-library/facets', { Cookie: ana.cookie }),
    );
    expect(facets.tags).toEqual([
      { value: 'shared', count: 2 },
      { value: 'solo', count: 1 },
    ]);
  });
});

describe('listing and filtering', () => {
  it('shows the paper summary with the reader entry, newest added first', async () => {
    const ana = await login(`lib-list-${run}`);
    await add(ana.cookie, first);
    await add(ana.cookie, second);

    const page = await library(ana.cookie);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual([second, first]);
    expect(page.items[0]).toMatchObject({
      title: `Deep Residual Learning ${run}`,
      authors: ['Ada Lovelace'],
      library: { paperId: second, status: 'to-read', tags: [] },
    });
  });

  it('filters by status and reports the counts of every status', async () => {
    const ana = await login(`lib-status-${run}`);
    await add(ana.cookie, first, 'reading');
    await add(ana.cookie, second, 'read');
    await add(ana.cookie, third);

    const reading = await library(ana.cookie, '?status=reading');
    expect(reading.items.map((i) => i.id)).toEqual([first]);

    const facets = await json<any>(
      await get('/paper-library/facets', { Cookie: ana.cookie }),
    );
    expect(facets).toMatchObject({
      total: 3,
      statuses: [
        { value: 'to-read', count: 1 },
        { value: 'reading', count: 1 },
        { value: 'read', count: 1 },
      ],
    });
  });

  it('filters by tag, whatever the case, and combines with the catalog filters', async () => {
    const ana = await login(`lib-ftag-${run}`);
    for (const id of [first, second, third]) await add(ana.cookie, id);
    await patch(`/paper-library/${first}`, { tags: ['survey'] }, ana.cookie);
    await patch(`/paper-library/${second}`, { tags: ['survey'] }, ana.cookie);

    expect(
      (await library(ana.cookie, '?tag=SURVEY')).items.map((i) => i.id).sort(),
    ).toEqual([first, second].sort());
    expect(
      (await library(ana.cookie, `?tag=survey&area=nlp-${run}`)).items.map(
        (i) => i.id,
      ),
    ).toEqual([first]);
    expect((await library(ana.cookie, `?q=zebra&tag=survey`)).total).toBe(0);
  });

  it('searches the titles and authors of the library only', async () => {
    const ana = await login(`lib-search-${run}`);
    await add(ana.cookie, first);

    expect((await library(ana.cookie, `?q=attention`)).total).toBe(1);
    expect((await library(ana.cookie, `?q=residual`)).total).toBe(0);
  });

  it('sorts by title, by finishing day and by rating', async () => {
    const ana = await login(`lib-sort-${run}`);
    for (const id of [first, second, third]) await add(ana.cookie, id);
    await patch(
      `/paper-library/${first}`,
      { status: 'read', completedAt: '2024-01-10', rating: 3 },
      ana.cookie,
    );
    await patch(
      `/paper-library/${second}`,
      { status: 'read', completedAt: '2024-06-01', rating: 5 },
      ana.cookie,
    );

    const ids = async (sort: string) =>
      (await library(ana.cookie, `?sort=${sort}`)).items.map((i) => i.id);
    expect(await ids('title')).toEqual([first, second, third]);
    expect(await ids('completed')).toEqual([second, first, third]);
    expect(await ids('rating')).toEqual([second, first, third]);
  });

  it('pages the results', async () => {
    const ana = await login(`lib-page-${run}`);
    for (const id of [first, second, third]) await add(ana.cookie, id);

    const one = await library(ana.cookie, '?limit=2&page=1&sort=title');
    expect(one).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(one.items).toHaveLength(2);
    const two = await library(ana.cookie, '?limit=2&page=2&sort=title');
    expect(two.items.map((i) => i.id)).toEqual([third]);
  });

  it.each([
    ['an unknown status', '?status=abandoned'],
    ['an unknown sort', '?sort=random'],
    ['a misspelled filter', '?staus=read'],
    ['a long tag', `?tag=${'x'.repeat(41)}`],
  ])('answers 400 for %s', async (_name, query) => {
    const ana = await login(`lib-q400-${run}`);
    expect(
      (await get(`/paper-library${query}`, { Cookie: ana.cookie })).status,
    ).toBe(400);
  });

  it('treats % and _ in a search as characters, not wildcards', async () => {
    const ana = await login(`lib-like-${run}`);
    await add(ana.cookie, first);
    expect((await library(ana.cookie, '?q=%25')).total).toBe(0);
  });
});

describe('removing a paper', () => {
  it('takes it out of the library and leaves the paper and other readers alone', async () => {
    const ana = await login(`lib-rm-a-${run}`);
    const bia = await login(`lib-rm-b-${run}`);
    await add(ana.cookie, first);
    await add(bia.cookie, first, 'reading');

    const res = await del(`/paper-library/${first}`, { Cookie: ana.cookie });
    expect(res.status).toBe(204);

    expect((await library(ana.cookie)).total).toBe(0);
    expect(
      await json(await get(`/paper-library/${first}`, { Cookie: bia.cookie })),
    ).toMatchObject({ status: 'reading' });
    expect((await get(`/papers/${first}`)).status).toBe(200);
  });

  it('is safe to repeat', async () => {
    const ana = await login(`lib-rm-twice-${run}`);
    await add(ana.cookie, first);
    expect(
      (await del(`/paper-library/${first}`, { Cookie: ana.cookie })).status,
    ).toBe(204);
    expect(
      (await del(`/paper-library/${first}`, { Cookie: ana.cookie })).status,
    ).toBe(204);
    // A paper that is not in the library is a no-op, a paper that does not exist is a 404.
    expect(
      (await del(`/paper-library/${third}`, { Cookie: ana.cookie })).status,
    ).toBe(204);
    expect(
      (await del(`/paper-library/${UNKNOWN_ID}`, { Cookie: ana.cookie })).status,
    ).toBe(404);
    expect(
      (await del('/paper-library/99999999999', { Cookie: ana.cookie })).status,
    ).toBe(404);
  });

  it('goes away with the paper', async () => {
    const ana = await login(`lib-cascade-${run}`);
    const gone = await seed('Short lived');
    await add(ana.cookie, gone);
    await del(`/papers/_test/${gone}`);

    expect((await library(ana.cookie)).total).toBe(0);
  });
});
