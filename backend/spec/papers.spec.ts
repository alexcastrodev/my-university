import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { json } from './helpers';
import { PapersApp, startPapersApp } from './papers-app';

// Talks HTTP to a Nest server (spec/papers-app.ts) backed by the real Postgres. Each test sends a
// request and asserts on the response. Titles and DOIs carry a per-run token so they never meet
// leftovers of an interrupted run.
const run = Math.random().toString(36).slice(2, 8);
/** A well-formed public id that no paper has. */
const UNKNOWN_ID = '01a191ed-2e04-7235-ae86-8483c518560e';
const doi = (n: string) => `10.5555/${run}.${n}`;
const title = (n: string) => `Spec paper ${run} ${n}`;

interface Result {
  paper: {
    id: string;
    title: string;
    doi: string | null;
    abstract: string | null;
    venue: string | null;
    publicationDate: string | null;
    type: string;
    authors: { name: string; orcid: string | null }[];
    keywords: string[];
  };
  created: boolean;
  conflicts: {
    field: string;
    current: unknown;
    incoming: unknown;
    resolution: string;
  }[];
}

let app: PapersApp;
const created = new Set<string>();

const jsonInit = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

async function add(data: Record<string, unknown>, query = '') {
  const res = await fetch(`${app.url}/papers${query}`, jsonInit('POST', data));
  const body = await json<Result>(res);
  if (res.status < 300) created.add(body.paper.id);
  return { res, body };
}
const correct = (id: string, data: Record<string, unknown>) =>
  fetch(`${app.url}/papers/${id}`, jsonInit('PUT', data));
const read = (id: string) => fetch(`${app.url}/papers/${id}`);

beforeAll(async () => {
  app = await startPapersApp();
});
afterEach(async () => {
  await Promise.all(
    [...created].map((id) =>
      fetch(`${app.url}/papers/${id}`, { method: 'DELETE' }),
    ),
  );
  created.clear();
});
afterAll(() => app.close());

describe('POST /papers: a new paper', () => {
  it('answers 201 with the normalized record, authors in order and keywords as a list', async () => {
    const { res, body } = await add({
      title: title('full'),
      abstract: 'We study things.',
      doi: `https://doi.org/${doi('FULL').toUpperCase()}`,
      venue: 'Journal of Specs',
      publicationDate: '2024-05',
      url: 'https://example.org/paper',
      researchArea: 'Distributed Systems',
      type: 'journal-article',
      authors: [
        { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' },
        { name: 'Turing, Alan' },
      ],
      keywords: ['Consensus', 'Graphs, Theory', 'consensus'],
    });
    expect(res.status).toBe(201);
    expect(body.created).toBe(true);
    expect(body.conflicts).toEqual([]);
    expect(body.paper).toMatchObject({
      title: title('full'),
      doi: doi('full'),
      venue: 'Journal of Specs',
      publicationDate: '2024-05',
      type: 'journal-article',
      authors: [
        { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' },
        { name: 'Turing, Alan', orcid: null },
      ],
      // "Graphs, Theory" stays one keyword, and the repeated one is stored once.
      keywords: ['consensus', 'graphs, theory'],
    });
  });

  it('has no owner: nothing in the record ties it to a user', async () => {
    const { body } = await add({ title: title('owner'), doi: doi('owner') });
    expect(Object.keys(body.paper).sort()).toEqual(
      [
        'abstract',
        'authors',
        'createdAt',
        'doi',
        'id',
        'keywords',
        'publicationDate',
        'researchArea',
        'title',
        'type',
        'updatedAt',
        'url',
        'venue',
      ].sort(),
    );
  });

  it('accepts a paper with only a title and a DOI, leaving the rest empty', async () => {
    const { res, body } = await add({ title: title('bare'), doi: doi('bare') });
    expect(res.status).toBe(201);
    expect(body.paper).toMatchObject({
      abstract: null,
      venue: null,
      publicationDate: null,
      type: 'other',
      authors: [],
      keywords: [],
    });
  });

  it('accepts a paper without a DOI when it has a date or an author to be told apart by', async () => {
    const byDate = await add({
      title: title('nodoi-date'),
      publicationDate: '2019',
    });
    const byAuthor = await add({
      title: title('nodoi-author'),
      authors: [{ name: 'Grace Hopper' }],
    });
    expect(byDate.res.status).toBe(201);
    expect(byDate.body.paper.doi).toBeNull();
    expect(byAuthor.res.status).toBe(201);
  });

  it('answers 400 for a paper with no DOI, no date and no author', async () => {
    const { res } = await add({ title: title('anonymous') });
    expect(res.status).toBe(400);
  });

  it.each([
    ['a DOI that is not one', { doi: 'not-a-doi' }],
    ['no title', { title: undefined }],
    ['a blank title', { title: '   ' }],
    ['an unknown type', { type: 'blog-post' }],
    ['a malformed date', { publicationDate: '2024-13' }],
    ['a URL that is not http(s)', { url: 'javascript:alert(1)' }],
    ['a malformed ORCID', { authors: [{ name: 'A B', orcid: '123' }] }],
    ['an author without a name', { authors: [{ name: '' }] }],
    ['an author with a blank name', { authors: [{ name: '   ' }] }],
  ])('answers 400 for %s', async (_label, patch) => {
    const { res } = await add({
      title: title('invalid'),
      doi: doi('invalid'),
      ...patch,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /papers: the same DOI never makes a second paper', () => {
  it('answers 200 with the same paper for every spelling of the DOI', async () => {
    const first = await add({ title: title('doi'), doi: doi('spell') });
    expect(first.res.status).toBe(201);

    for (const spelling of [
      doi('spell').toUpperCase(),
      `doi:${doi('spell')}`,
      `https://doi.org/${doi('spell')}`,
      `http://dx.doi.org/${doi('spell')}`,
      `  ${doi('spell')}  `,
    ]) {
      const again = await add({ title: title('doi'), doi: spelling });
      expect(again.res.status, spelling).toBe(200);
      expect(again.body.created).toBe(false);
      expect(again.body.paper.id).toBe(first.body.paper.id);
    }
  });

  it('creates exactly one paper when the same DOI arrives at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        add({ title: title('race'), doi: doi('race') }),
      ),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.res.status === 200)).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.paper.id)).size).toBe(1);
  });
});

describe('POST /papers: papers without a DOI', () => {
  const lovelace = {
    title: title('dedupe'),
    publicationDate: '2020-03-01',
    authors: [{ name: 'Ada Lovelace' }],
  };

  it('recognizes the same paper despite case, accents, punctuation and name order', async () => {
    const first = await add(lovelace);
    const again = await add({
      title: `  ${title('dedupe').toUpperCase()}.  `,
      publicationDate: '2020',
      authors: [{ name: 'Lovelace, Ada' }],
    });
    expect(first.res.status).toBe(201);
    expect(again.res.status).toBe(200);
    expect(again.body.paper.id).toBe(first.body.paper.id);

    const accented = await add({
      title: 'Élan Vitál ' + run,
      publicationDate: '2001',
      authors: [{ name: 'José Álvarez' }],
    });
    const plain = await add({
      title: 'Elan Vital ' + run,
      publicationDate: '2001',
      authors: [{ name: 'Jose Alvarez' }],
    });
    expect(plain.body.paper.id).toBe(accented.body.paper.id);
  });

  it('keeps papers apart when the year or the first author differs', async () => {
    const first = await add(lovelace);
    const otherYear = await add({ ...lovelace, publicationDate: '2021' });
    const otherAuthor = await add({
      ...lovelace,
      authors: [{ name: 'Grace Hopper' }],
    });
    expect(otherYear.res.status).toBe(201);
    expect(otherAuthor.res.status).toBe(201);
    expect(
      new Set([
        first.body.paper.id,
        otherYear.body.paper.id,
        otherAuthor.body.paper.id,
      ]).size,
    ).toBe(3);
  });

  it('creates exactly one paper when the same DOI-less paper arrives at the same time', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => add(lovelace)),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.paper.id)).size).toBe(1);
  });

  it('attaches a DOI that shows up later to the paper that had none', async () => {
    const first = await add(lovelace);
    const later = await add({ ...lovelace, doi: doi('later') });
    expect(later.res.status).toBe(200);
    expect(later.body.paper.id).toBe(first.body.paper.id);
    expect(later.body.paper.doi).toBe(doi('later'));
  });

  it('does not create a DOI-less duplicate of a paper that already has a DOI', async () => {
    const withDoi = await add({ ...lovelace, doi: doi('has') });
    const without = await add(lovelace);
    expect(without.res.status).toBe(200);
    expect(without.body.paper.id).toBe(withDoi.body.paper.id);
  });

  it('keeps two papers with different DOIs apart even when title, year and author match', async () => {
    const preprint = await add({
      ...lovelace,
      doi: doi('preprint'),
      type: 'preprint',
    });
    const published = await add({
      ...lovelace,
      doi: doi('published'),
      type: 'journal-article',
    });
    expect(published.res.status).toBe(201);
    expect(published.body.paper.id).not.toBe(preprint.body.paper.id);
  });
});

describe('POST /papers: a paper that already exists', () => {
  it('fills what is empty and leaves what is set, reporting the disagreement', async () => {
    const first = await add(
      {
        title: title('merge'),
        doi: doi('merge'),
        venue: 'Venue A',
        publicationDate: '2022',
      },
      '?source=crossref&externalId=cr-1',
    );
    const second = await add(
      {
        title: title('merge'),
        doi: doi('merge'),
        venue: 'Venue B',
        abstract: 'Now with an abstract.',
        researchArea: 'Systems',
      },
      '?source=openalex&externalId=oa-9',
    );
    expect(second.res.status).toBe(200);
    expect(second.body.paper).toMatchObject({
      id: first.body.paper.id,
      venue: 'Venue A',
      abstract: 'Now with an abstract.',
      publicationDate: '2022',
    });
    expect(second.body.conflicts).toEqual([
      {
        field: 'venue',
        current: 'Venue A',
        incoming: 'Venue B',
        resolution: 'kept-current',
      },
    ]);
  });

  it('does not call a different spelling of the same value a conflict', async () => {
    await add({
      title: title('same'),
      doi: doi('same'),
      venue: 'Journal of Specs',
    });
    const again = await add({
      title: title('same').toUpperCase(),
      doi: doi('same'),
      venue: 'journal of specs.',
    });
    expect(again.body.conflicts).toEqual([]);
  });

  it('reports a different list of authors as a conflict and keeps the stored one', async () => {
    await add({
      title: title('authors'),
      doi: doi('authors'),
      authors: [{ name: 'Ada Lovelace' }, { name: 'Alan Turing' }],
    });
    const again = await add({
      title: title('authors'),
      doi: doi('authors'),
      authors: [{ name: 'Grace Hopper' }],
    });
    expect(again.body.paper.authors.map((a) => a.name)).toEqual([
      'Ada Lovelace',
      'Alan Turing',
    ]);
    expect(again.body.conflicts).toMatchObject([
      {
        field: 'authors',
        current: ['Ada Lovelace', 'Alan Turing'],
        incoming: ['Grace Hopper'],
        resolution: 'kept-current',
      },
    ]);
  });

  it('treats the same authors in another spelling as the same, and completes their ORCID', async () => {
    await add({
      title: title('orcid'),
      doi: doi('orcid'),
      authors: [{ name: 'Ada Lovelace' }],
    });
    const again = await add({
      title: title('orcid'),
      doi: doi('orcid'),
      authors: [{ name: 'Lovelace, Ada', orcid: '0000-0002-1825-0097' }],
    });
    expect(again.body.conflicts).toEqual([]);
    expect(again.body.paper.authors).toEqual([
      { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' },
    ]);
  });

  it('adds new keywords to the stored ones', async () => {
    await add({
      title: title('kw'),
      doi: doi('kw'),
      keywords: ['raft', 'paxos'],
    });
    const again = await add({
      title: title('kw'),
      doi: doi('kw'),
      keywords: ['Paxos', 'Quorum'],
    });
    expect(again.body.paper.keywords).toEqual(['paxos', 'quorum', 'raft']);
  });
});

describe('GET /papers/:id: provenance', () => {
  it('lists every source that touched the paper, in order, with its conflicts', async () => {
    const first = await add(
      { title: title('prov'), doi: doi('prov'), venue: 'A' },
      '?source=crossref&externalId=cr-1',
    );
    await add(
      { title: title('prov'), doi: doi('prov'), venue: 'B' },
      '?source=openalex&externalId=oa-9',
    );

    const res = await read(first.body.paper.id);
    expect(res.status).toBe(200);
    const paper = await json<{
      sources: {
        source: string;
        externalId: string;
        retrievedAt: string;
        conflicts: unknown[];
      }[];
    }>(res);
    expect(paper.sources.map((s) => [s.source, s.externalId])).toEqual([
      ['crossref', 'cr-1'],
      ['openalex', 'oa-9'],
    ]);
    expect(paper.sources[0].conflicts).toEqual([]);
    expect(paper.sources[1].conflicts).toMatchObject([
      { field: 'venue', resolution: 'kept-current' },
    ]);
    expect(Date.parse(paper.sources[0].retrievedAt)).not.toBeNaN();
  });

  it('answers 404 for a paper that does not exist', async () => {
    expect((await read(UNKNOWN_ID)).status).toBe(404);
  });
});

describe('PUT /papers/:id: a correction', () => {
  it('replaces the given fields, keeps the others, and records what it replaced', async () => {
    const first = await add({
      title: title('fix'),
      doi: doi('fix'),
      venue: 'Wrong Venue',
      abstract: 'Keep me.',
    });
    const res = await correct(first.body.paper.id, {
      title: title('fix'),
      venue: 'Right Venue',
    });
    const body = await json<Result>(res);

    expect(res.status).toBe(200);
    expect(body.paper).toMatchObject({
      venue: 'Right Venue',
      abstract: 'Keep me.',
      doi: doi('fix'),
    });
    expect(body.conflicts).toEqual([
      {
        field: 'venue',
        current: 'Wrong Venue',
        incoming: 'Right Venue',
        resolution: 'replaced',
      },
    ]);

    const sources = (
      await json<{ sources: { source: string }[] }>(
        await read(first.body.paper.id),
      )
    ).sources;
    expect(sources.map((s) => s.source)).toEqual(['manual', 'manual']);
  });

  it('can replace the authors and drop keywords', async () => {
    const first = await add({
      title: title('fix2'),
      doi: doi('fix2'),
      authors: [{ name: 'Wrong Person' }],
      keywords: ['a', 'b'],
    });
    const body = await json<Result>(
      await correct(first.body.paper.id, {
        title: title('fix2'),
        authors: [{ name: 'Right Person' }],
        keywords: ['b'],
      }),
    );
    expect(body.paper.authors).toEqual([{ name: 'Right Person', orcid: null }]);
    expect(body.paper.keywords).toEqual(['b']);
    expect(body.conflicts.map((c) => c.field).sort()).toEqual([
      'authors',
      'keywords',
    ]);
  });

  it('answers 404 for a paper that does not exist', async () => {
    expect((await correct(UNKNOWN_ID, { title: title('ghost') })).status).toBe(
      404,
    );
  });

  it('answers 409 when the new DOI belongs to another paper', async () => {
    await add({ title: title('own-a'), doi: doi('own-a') });
    const other = await add({ title: title('own-b'), doi: doi('own-b') });
    const res = await correct(other.body.paper.id, {
      title: title('own-b'),
      doi: doi('own-a'),
    });
    expect(res.status).toBe(409);
  });
});
