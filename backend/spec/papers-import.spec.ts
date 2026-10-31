import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportApp, StubReply, startImportApp } from './papers-import-app';

// Requests to the real controllers (spec/papers-import-app.ts) backed by the real Postgres, with a stub in
// place of Crossref: each test sends a request and asserts on the response. Every DOI and title carries a
// per-run token, so a test only sees its own papers. Nothing here reaches the real Crossref.
const run = Math.random().toString(36).slice(2, 8);
let counter = 0;
/** A DOI nobody used before: lowercase, like the stored form. */
const newDoi = () => `10.5555/${run}.n${counter++}`;

let app: ImportApp;

const send = (method: string, path: string, data?: unknown, cookie?: string) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
const json = <T = any>(res: Response) => res.json() as Promise<T>;

/** A signed-in reader, through the dev-only login (what the browser tests use too). */
async function signIn(name: string): Promise<string> {
  const res = await send('POST', '/auth/_test/login', {
    displayName: `${name}-${run}`,
  });
  expect(res.status).toBe(201);
  return (res.headers.getSetCookie()[0] ?? '').split(';')[0];
}

const preview = (cookie: string | undefined, doi: unknown) =>
  send('POST', '/papers/import/preview', { doi }, cookie);
const importDoi = (cookie: string | undefined, doi: unknown) =>
  send('POST', '/papers/import', { doi }, cookie);
const create = (cookie: string | undefined, body: unknown) =>
  send('POST', '/papers', body, cookie);

/** What Crossref says about a DOI, as its API wraps it. */
const record = (doi: string, message: Record<string, unknown> = {}): StubReply => ({
  status: 200,
  body: {
    status: 'ok',
    'message-type': 'work',
    message: {
      DOI: doi.toUpperCase(),
      title: [`Imported paper ${run}`],
      type: 'journal-article',
      issued: { 'date-parts': [[2021, 3, 9]] },
      author: [{ given: 'Ada', family: 'Lovelace' }],
      ...message,
    },
  },
});
const know = (doi: string, message?: Record<string, unknown>) =>
  app.crossref.set(doi, record(doi, message));
const asked = (doi: string) => app.requests.filter((r) => r.doi === doi).length;

const sources = (paperId: number) =>
  app.dataSource.query(
    `SELECT source, "externalId", "retrievedAt", conflicts, payload FROM paper_source WHERE "paperId" = $1 ORDER BY id`,
    [paperId],
  );
const papersWithDoi = async (doi: string) =>
  (
    await json<{ total: number }>(
      await fetch(`${app.url}/papers?doi=${encodeURIComponent(doi)}`),
    )
  ).total;

beforeAll(async () => {
  app = await startImportApp();
});
afterAll(async () => {
  await app.dataSource.query(`DELETE FROM paper WHERE doi LIKE $1 OR title LIKE $2`, [
    `10.5555/${run}.%`,
    `%${run}%`,
  ]);
  await app.dataSource.query(`DELETE FROM "user" WHERE "githubLogin" LIKE $1`, [`%-${run}`]);
  await app.close();
});

describe('who may import', () => {
  it.each([
    ['preview', (d: string) => preview(undefined, d)],
    ['import', (d: string) => importDoi(undefined, d)],
    ['manual creation', (d: string) => create(undefined, { title: 'x', doi: d })],
  ])('refuses %s without a session (401) and never asks the provider', async (_name, call) => {
    const doi = newDoi();
    know(doi);
    expect((await call(doi)).status).toBe(401);
    expect(asked(doi)).toBe(0);
  });
});

describe('preview', () => {
  it('maps the provider record to the paper model without storing anything', async () => {
    const cookie = await signIn('p1');
    const doi = newDoi();
    know(doi, {
      title: ['Attention <i>Is</i> All You Need'],
      subtitle: ['A study'],
      abstract:
        '<jats:title>Abstract</jats:title><jats:p>First &amp; foremost &lt;b&gt;paragraph&lt;/b&gt;.</jats:p><jats:p>Second   paragraph.</jats:p>',
      author: [
        { given: 'Ada', family: 'Lovelace', ORCID: 'http://orcid.org/0000-0002-1825-0097' },
        { given: 'Grace', family: 'Hopper', ORCID: 'not an orcid' },
        { name: 'The Consortium' },
        { given: '', family: '' },
      ],
      issued: { 'date-parts': [[2017, 6, 12]] },
      'container-title': ['Journal of Tests'],
      subject: ['Computer Science', 'Artificial Intelligence', 'Computer Science'],
      resource: { primary: { URL: 'https://publisher.example/paper' } },
      link: [{ URL: 'https://publisher.example/paper.pdf', 'content-type': 'application/pdf' }],
    });

    const res = await preview(cookie, doi);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      doi,
      source: { name: 'crossref' },
      match: null,
      conflicts: [],
      candidate: {
        title: 'Attention Is All You Need: A study',
        abstract: 'First & foremost <b>paragraph</b>.\n\nSecond paragraph.',
        doi,
        venue: 'Journal of Tests',
        publicationDate: '2017-06-12',
        url: 'https://publisher.example/paper',
        type: 'journal-article',
        authors: [
          { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' },
          { name: 'Grace Hopper' },
          { name: 'The Consortium' },
        ],
        keywords: ['Computer Science', 'Artificial Intelligence'],
      },
    });
    expect(new Date(body.source.retrievedAt).getTime()).toBeLessThanOrEqual(Date.now());
    // The publisher's full-text link is never carried over: no PDF is fetched or pointed at.
    expect(JSON.stringify(body)).not.toContain('paper.pdf');
    expect(await papersWithDoi(doi)).toBe(0);
  });

  it.each([
    ['https://doi.org/', (d: string) => `https://doi.org/${d.toUpperCase()}`],
    ['doi:', (d: string) => `doi:${d}`],
    ['spaces around it', (d: string) => `  ${d}  `],
  ])('accepts a DOI written as %s and stores the normalized one', async (_name, spell) => {
    const cookie = await signIn('p2');
    const doi = newDoi();
    know(doi);
    const res = await preview(cookie, spell(doi));
    expect(res.status).toBe(200);
    expect((await json(res)).doi).toBe(doi);
    expect(asked(doi)).toBe(1);
  });

  it.each([
    ['text', 'not a doi'],
    ['a DOI without a suffix', '10.1234/'],
    ['a registrant that is too short', '10.12/abc'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a path that climbs out of the lookup', '10.1234/../../members'],
  ])('refuses %s before asking the provider (400)', async (_name, bad) => {
    const cookie = await signIn('p3');
    const before = app.requests.length;
    const res = await preview(cookie, bad);
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: 'invalid_doi' });
    expect(app.requests.length).toBe(before);
  });

  it('refuses a body that is not a DOI string (400)', async () => {
    const cookie = await signIn('p4');
    expect((await preview(cookie, 42)).status).toBe(400);
    expect((await send('POST', '/papers/import/preview', {}, cookie)).status).toBe(400);
    expect((await preview(cookie, 'x'.repeat(301))).status).toBe(400);
  });

  it.each([
    ['year only', [[2024]], '2024'],
    ['year and month', [[2024, 5]], '2024-05'],
    ['a full date', [[2024, 5, 17]], '2024-05-17'],
    ['a date with a null part', [[null]], undefined],
    ['an impossible month', [[2024, 13, 1]], '2024'],
  ])('reads a publication date of %s', async (_name, parts, expected) => {
    const cookie = await signIn('p5');
    const doi = newDoi();
    know(doi, { issued: { 'date-parts': parts } });
    const body = await json(await preview(cookie, doi));
    expect(body.candidate.publicationDate).toBe(expected);
  });

  it.each([
    ['journal-article', 'journal-article'],
    ['proceedings-article', 'conference-paper'],
    ['posted-content', 'preprint'],
    ['book-chapter', 'book-chapter'],
    ['monograph', 'book'],
    ['dissertation', 'thesis'],
    ['report', 'report'],
    ['dataset', 'other'],
  ])('maps the Crossref type %s to %s', async (type, expected) => {
    const cookie = await signIn('p6');
    const doi = newDoi();
    know(doi, { type });
    expect((await json(await preview(cookie, doi))).candidate.type).toBe(expected);
  });

  it('does not rebuild a tag out of nested ones, and keeps a lone < as text', async () => {
    const cookie = await signIn('p6b');
    const doi = newDoi();
    know(doi, {
      title: ['<scr<b>ipt>Nested</scr</b>ipt> title'],
      abstract: '<jats:p><scr<i>ipt>x</scr</i>ipt> with p &lt; 0.05 and a < b</jats:p>',
    });
    const { candidate } = await json(await preview(cookie, doi));
    for (const text of [candidate.title, candidate.abstract]) {
      expect(text).not.toMatch(/<[a-z/!?]/i);
    }
    expect(candidate.title).toBe('ipt>Nestedipt> title');
    expect(candidate.abstract).toBe('ipt>xipt> with p < 0.05 and a < b');
  });

  it('keeps provider limits: at most 500 authors, and a record with no usable title is refused', async () => {
    const cookie = await signIn('p7');
    const many = newDoi();
    know(many, {
      author: Array.from({ length: 600 }, (_, i) => ({ given: 'A', family: `Author${i}` })),
    });
    const body = await json(await preview(cookie, many));
    expect(body.candidate.authors).toHaveLength(500);

    const untitled = newDoi();
    know(untitled, { title: ['<i></i>'] });
    const res = await preview(cookie, untitled);
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ code: 'provider_invalid' });
  });

  it('shows the paper a DOI would match and where the provider disagrees, changing nothing', async () => {
    const cookie = await signIn('p8');
    const doi = newDoi();
    const made = await create(cookie, {
      title: `Stored title ${run}`,
      doi,
      authors: [{ name: 'Ada Lovelace' }],
      venue: 'Stored venue',
    });
    expect(made.status).toBe(201);
    const id = (await json(made)).paper.id;
    know(doi, { title: ['Provider title'], 'container-title': ['Provider venue'], abstract: '<jats:p>Filled in</jats:p>' });

    const res = await preview(cookie, doi);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.match).toMatchObject({ id, title: `Stored title ${run}`, abstract: 'Filled in' });
    expect(body.conflicts.map((c: any) => [c.field, c.resolution])).toEqual(
      expect.arrayContaining([
        ['title', 'kept-current'],
        ['venue', 'kept-current'],
      ]),
    );

    const stored = await json(await fetch(`${app.url}/papers/${id}`));
    expect(stored).toMatchObject({ title: `Stored title ${run}`, abstract: null, venue: 'Stored venue' });
    expect(await sources(id)).toHaveLength(1);
  });
});

describe('provider trouble', () => {
  it('answers 404 not_found for a DOI the provider does not have', async () => {
    const cookie = await signIn('e1');
    const res = await preview(cookie, newDoi());
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ code: 'not_found' });
  });

  it('passes a provider rate limit on as 429 rate_limited with the wait', async () => {
    const cookie = await signIn('e2');
    const doi = newDoi();
    app.crossref.set(doi, { status: 429, body: 'slow down', headers: { 'Retry-After': '17' } });
    const res = await preview(cookie, doi);
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: 'rate_limited', retryAfter: 17 });
  });

  it.each([
    ['500', { status: 500, body: 'boom' }],
    ['503', { status: 503, body: 'down' }],
    ['a dropped connection', { drop: true }],
  ] as [string, StubReply][])('answers 502 provider_unavailable for %s', async (_name, reply) => {
    const cookie = await signIn('e3');
    const doi = newDoi();
    app.crossref.set(doi, reply);
    const res = await preview(cookie, doi);
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ code: 'provider_unavailable' });
  });

  it.each([
    ['text that is not JSON', { status: 200, body: '<html>maintenance</html>' }],
    ['JSON without a record', { status: 200, body: { status: 'ok' } }],
  ] as [string, StubReply][])('answers 502 provider_invalid for %s', async (_name, reply) => {
    const cookie = await signIn('e4');
    const doi = newDoi();
    app.crossref.set(doi, reply);
    const res = await preview(cookie, doi);
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ code: 'provider_invalid' });
  });

  it('does not remember a failure: the next lookup asks again', async () => {
    const cookie = await signIn('e5');
    const doi = newDoi();
    app.crossref.set(doi, { status: 500, body: 'boom' });
    expect((await preview(cookie, doi)).status).toBe(502);
    know(doi);
    expect((await preview(cookie, doi)).status).toBe(200);
    expect(asked(doi)).toBe(2);
  });

  it('never blocks creating the paper by hand', async () => {
    const cookie = await signIn('e6');
    const doi = newDoi();
    app.crossref.set(doi, { status: 503, body: 'down' });
    expect((await importDoi(cookie, doi)).status).toBe(502);
    expect(await papersWithDoi(doi)).toBe(0);

    const res = await create(cookie, { title: `Typed by hand ${run}`, doi, authors: [{ name: 'Grace Hopper' }] });
    expect(res.status).toBe(201);
    expect(await papersWithDoi(doi)).toBe(1);
  });
});

describe('import', () => {
  it('creates the paper and records Crossref, the DOI and the retrieval time as its provenance', async () => {
    const cookie = await signIn('i1');
    const doi = newDoi();
    know(doi, { 'container-title': ['Journal of Tests'], subject: ['Testing'] });

    const res = await importDoi(cookie, doi);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({
      created: true,
      conflicts: [],
      paper: { doi, title: `Imported paper ${run}`, venue: 'Journal of Tests', keywords: ['testing'], type: 'journal-article' },
    });

    const shown = await json(await fetch(`${app.url}/papers/${body.paper.id}`));
    expect(shown).toMatchObject({ doi, title: `Imported paper ${run}` });
    expect(shown).not.toHaveProperty('sources');

    const rows = await sources(body.paper.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'crossref', externalId: doi, conflicts: [] });
    expect(rows[0].payload).toMatchObject({ doi, title: `Imported paper ${run}` });
    expect(new Date(rows[0].retrievedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('matches an existing DOI instead of duplicating it, and keeps one provenance row per import', async () => {
    const cookie = await signIn('i2');
    const doi = newDoi();
    know(doi);
    const first = await importDoi(cookie, doi);
    const second = await importDoi(cookie, doi);
    expect([first.status, second.status]).toEqual([201, 200]);
    const a = await json(first);
    const b = await json(second);
    expect(b.created).toBe(false);
    expect(b.paper.id).toBe(a.paper.id);
    expect(await papersWithDoi(doi)).toBe(1);
    expect(await sources(a.paper.id)).toHaveLength(2);
  });

  it('never overwrites what is stored: the disagreement is returned and kept in the provenance', async () => {
    const cookie = await signIn('i3');
    const doi = newDoi();
    const made = await json(
      await create(cookie, { title: `Original title ${run}`, doi, authors: [{ name: 'Ada Lovelace' }] }),
    );
    know(doi, { title: ['Provider title'] });

    const res = await importDoi(cookie, doi);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.paper).toMatchObject({ id: made.paper.id, title: `Original title ${run}` });
    expect(body.conflicts).toEqual([
      { field: 'title', current: `Original title ${run}`, incoming: 'Provider title', resolution: 'kept-current' },
    ]);
    const rows = await sources(made.paper.id);
    expect(rows.map((r: any) => r.source)).toEqual(['manual', 'crossref']);
    expect(rows[1].conflicts).toEqual(body.conflicts);
  });

  it('matches a paper that was entered by hand without a DOI, and gives it the DOI', async () => {
    const cookie = await signIn('i4');
    const doi = newDoi();
    const made = await json(
      await create(cookie, {
        title: `The same paper ${run}`,
        publicationDate: '2021-03-09',
        authors: [{ name: 'Lovelace, Ada' }],
      }),
    );
    expect(made.paper.doi).toBeNull();
    know(doi, { title: [`The same paper ${run}`], author: [{ given: 'Ada', family: 'Lovelace' }] });

    const res = await importDoi(cookie, doi);
    expect(res.status).toBe(200);
    expect((await json(res)).paper).toMatchObject({ id: made.paper.id, doi });
  });

  it('ends in one paper when the same DOI is imported at the same moment', async () => {
    const cookies = await Promise.all([signIn('i5a'), signIn('i5b'), signIn('i5c'), signIn('i5d')]);
    const doi = newDoi();
    know(doi);
    const results = await Promise.all(cookies.map((c) => importDoi(c, doi)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(await papersWithDoi(doi)).toBe(1);
  });

  it('creates nothing when the provider fails', async () => {
    const cookie = await signIn('i6');
    const missing = newDoi();
    const down = newDoi();
    app.crossref.set(down, { status: 500, body: 'boom' });
    expect((await importDoi(cookie, missing)).status).toBe(404);
    expect((await importDoi(cookie, down)).status).toBe(502);
    expect((await importDoi(cookie, 'nope')).status).toBe(400);
    expect(await papersWithDoi(missing)).toBe(0);
    expect(await papersWithDoi(down)).toBe(0);
  });

  it('looks the DOI up once for a preview and the import that follows it', async () => {
    const cookie = await signIn('i7');
    const doi = newDoi();
    know(doi);
    expect((await preview(cookie, doi)).status).toBe(200);
    expect((await importDoi(cookie, doi)).status).toBe(201);
    expect(asked(doi)).toBe(1);
  });

  it('takes the metadata from the provider, never from the request', async () => {
    const cookie = await signIn('i8');
    const doi = newDoi();
    know(doi);
    const res = await send('POST', '/papers/import', { doi, title: 'Forged title', abstract: 'forged' }, cookie);
    expect(res.status).toBe(201);
    const { paper } = await json(res);
    expect(paper.title).toBe(`Imported paper ${run}`);
    expect(paper.abstract).toBeNull();
  });
});

describe('what stays on the server', () => {
  it('sends the contact address and a user agent to the provider only, and nothing of the reader', async () => {
    const cookie = await signIn('s1');
    process.env.CROSSREF_MAILTO = 'ops@example.org';
    try {
      const doi = newDoi();
      know(doi);
      const res = await preview(cookie, doi);
      expect(res.status).toBe(200);
      const [request] = app.requests.filter((r) => r.doi === doi);
      expect(request.search).toBe('?mailto=ops%40example.org');
      expect(request.headers['user-agent']).toContain('MyUniversity');
      expect(request.headers['user-agent']).toContain('ops@example.org');
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      expect(JSON.stringify(await json(res))).not.toContain('ops@example.org');
    } finally {
      delete process.env.CROSSREF_MAILTO;
    }
  });
});

describe('limits', () => {
  it('lets a reader look up 20 DOIs in ten minutes, then answers 429 with the wait; others are not affected', async () => {
    const heavy = await signIn('l1');
    const other = await signIn('l2');
    const doi = newDoi();
    know(doi);
    for (let i = 0; i < 20; i++) {
      expect((await preview(heavy, doi)).status).toBe(200);
    }
    const res = await preview(heavy, doi);
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body).toMatchObject({ code: 'too_many_requests' });
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(600);
    expect((await preview(other, doi)).status).toBe(200);
  });
});

describe('creating by hand', () => {
  it('creates the paper and records it as a manual source', async () => {
    const cookie = await signIn('m1');
    const doi = newDoi();
    const res = await create(cookie, {
      title: `Typed ${run}`,
      doi: `DOI:${doi.toUpperCase()}`,
      abstract: 'Typed abstract',
      authors: [{ name: 'Ada Lovelace', orcid: '0000-0002-1825-0097' }],
      keywords: ['Typed', ' typed '],
      type: 'preprint',
    });
    expect(res.status).toBe(201);
    const { paper, created } = await json(res);
    expect(created).toBe(true);
    expect(paper).toMatchObject({ doi, keywords: ['typed'], type: 'preprint' });
    expect((await sources(paper.id))[0]).toMatchObject({ source: 'manual', externalId: null });
  });

  it('answers 409 already_exists with the id when the DOI is taken, and does not touch that paper', async () => {
    const cookie = await signIn('m2');
    const doi = newDoi();
    const made = await json(await create(cookie, { title: `First ${run}`, doi, authors: [{ name: 'Ada Lovelace' }] }));

    const res = await create(cookie, { title: `Second ${run}`, doi, abstract: 'Filled by someone else' });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'already_exists', paperId: made.paper.id });
    const stored = await json(await fetch(`${app.url}/papers/${made.paper.id}`));
    expect(stored).toMatchObject({ title: `First ${run}`, abstract: null });
    expect(await sources(made.paper.id)).toHaveLength(1);
  });

  it('answers 409 when the same paper is entered again without a DOI', async () => {
    const cookie = await signIn('m3');
    const body = { title: `Twice ${run}`, publicationDate: '2020', authors: [{ name: 'Grace Hopper' }] };
    const first = await create(cookie, body);
    expect(first.status).toBe(201);
    const again = await create(cookie, { ...body, title: `TWICE ${run}!` });
    expect(again.status).toBe(409);
    expect((await json(again)).paperId).toBe((await json(first)).paper.id);
  });

  it.each([
    ['no title', { doi: '10.5555/x.1' }],
    ['a blank title', { title: '   ', doi: '10.5555/x.2' }],
    ['an invalid DOI', { title: 'T', doi: 'nonsense' }],
    ['nothing to tell it apart from other papers', { title: 'Introduction' }],
    ['a date that is not a date', { title: 'T', publicationDate: 'last year' }],
    ['a link that is not http', { title: 'T', doi: '10.5555/x.3', url: 'javascript:alert(1)' }],
    ['an unknown type', { title: 'T', doi: '10.5555/x.4', type: 'zine' }],
    ['an ORCID that is not one', { title: 'T', authors: [{ name: 'A', orcid: '123' }] }],
  ])('refuses %s (400)', async (_name, body) => {
    const cookie = await signIn('m4');
    expect((await create(cookie, body)).status).toBe(400);
  });

  it('is limited like lookups: 20 papers in ten minutes', async () => {
    const cookie = await signIn('m5');
    for (let i = 0; i < 20; i++) {
      const res = await create(cookie, { title: `Bulk ${run} ${i}`, doi: newDoi() });
      expect(res.status).toBe(201);
    }
    const res = await create(cookie, { title: `Bulk ${run} extra`, doi: newDoi() });
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: 'too_many_requests' });
  });
});
