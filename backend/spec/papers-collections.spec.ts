import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * Personal collections (#188). Every test is a request to the real Nest app (its own port, real database) and an
 * assertion on the response: who can reach a collection, what a collection holds, what leaving or deleting one
 * leaves behind, and in what order things come back.
 */
const run = Math.random().toString(36).slice(2, 8);
// Two digits, so that sorting the titles as text is sorting them by number.
const PAPERS = Array.from({ length: 40 }, (_, i) => ({
  slug: `col-${run}-${i + 1}`,
  title: `Collected paper ${String(i + 1).padStart(2, '0')} ${run}`,
}));

let app: AttachmentsApp;
let seq = 0;
const newPaper = () => PAPERS[seq++].slug;

async function signIn(name: string): Promise<string> {
  const res = await fetch(`${app.url}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `${name} ${run}` }),
  });
  expect(res.status).toBe(201);
  return (res.headers.getSetCookie()[0] ?? '').split(';')[0];
}

const send = (method: string, path: string, cookie?: string, data?: unknown) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

const body = async (res: Response): Promise<any> => res.json();
const collections = async (cookie: string): Promise<any[]> => {
  const res = await send('GET', '/paper-library/collections', cookie);
  expect(res.status).toBe(200);
  return (await body(res)).items;
};
const names = async (cookie: string) => (await collections(cookie)).map((c) => c.name);

async function make(cookie: string, name: string): Promise<any> {
  const res = await send('POST', '/paper-library/collections', cookie, { name });
  expect(res.status, await res.clone().text()).toBe(201);
  return body(res);
}

/** Puts a public paper in the library (status `to-read`) and returns its slug. */
async function keep(cookie: string, paper = newPaper(), status?: string): Promise<string> {
  const res = await send('POST', '/paper-library', cookie, { paperId: paper, ...(status ? { status } : {}) });
  expect(res.status, await res.clone().text()).toBe(201);
  return paper;
}

const put = (cookie: string, collection: string, paper: string) => send('PUT', `/paper-library/collections/${collection}/papers/${paper}`, cookie);
const take = (cookie: string, collection: string, paper: string) => send('DELETE', `/paper-library/collections/${collection}/papers/${paper}`, cookie);
const browse = async (cookie: string, query: string): Promise<{ items: any[]; total: number }> => {
  const res = await send('GET', `/paper-library?${query}`, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return body(res);
};
const slugs = (page: { items: any[] }) => page.items.map((i) => i.id);

beforeAll(async () => {
  app = await startAttachmentsApp({ maxBytes: 200_000, quotaBytes: 600_000 }, PAPERS);
});

afterAll(async () => {
  await app.dataSource.query(`DELETE FROM paper_attachment WHERE "paperSlug" LIKE $1`, [`col-${run}-%`]);
  await app.maintain();
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [`% ${run}`]);
  await app.close();
});

describe('who can reach collections', () => {
  it('needs a session on every route', async () => {
    const ana = await signIn('Ana');
    const mine = await make(ana, 'Thesis');
    const paper = await keep(ana);
    const base = '/paper-library/collections';
    for (const [method, path, data] of [
      ['GET', base, undefined],
      ['POST', base, { name: 'x' }],
      ['PATCH', `${base}/${mine.id}`, { name: 'x' }],
      ['DELETE', `${base}/${mine.id}`, undefined],
      ['PUT', `${base}/${mine.id}/papers/${paper}`, undefined],
      ['DELETE', `${base}/${mine.id}/papers/${paper}`, undefined],
    ] as const) {
      expect((await send(method, path, undefined, data)).status, `${method} ${path}`).toBe(401);
    }
    expect((await browse(ana, `collection=${mine.id}`)).total).toBe(0);
    expect((await send('GET', `/paper-library?collection=${mine.id}`)).status).toBe(401);
  });

  it('keeps a collection private: another reader sees none of it and cannot change, fill, empty, browse or delete it', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');
    const thesis = await make(ana, 'Thesis');
    const paper = await keep(ana);
    expect((await put(ana, thesis.id, paper)).status).toBe(200);
    const bobsPaper = await keep(bob, paper);

    expect(await collections(bob)).toEqual([]);
    expect((await send('PATCH', `/paper-library/collections/${thesis.id}`, bob, { name: 'Mine now' })).status).toBe(404);
    expect((await put(bob, thesis.id, bobsPaper)).status).toBe(404);
    expect((await take(bob, thesis.id, bobsPaper)).status).toBe(404);
    expect((await send('GET', `/paper-library?collection=${thesis.id}`, bob)).status).toBe(404);
    expect((await send('DELETE', `/paper-library/collections/${thesis.id}`, bob)).status).toBe(404);

    // Nothing moved: it is still Ana's, with her paper in it, and Bob's entry does not name it.
    expect(await collections(ana)).toMatchObject([{ id: thesis.id, name: 'Thesis', count: 1 }]);
    expect(slugs(await browse(ana, `collection=${thesis.id}`))).toEqual([paper]);
    const entry = await body(await send('GET', `/paper-library/${bobsPaper}`, bob));
    expect(entry.collections).toEqual([]);
  });

  it('answers 404 to an id that is no collection, and 400 to one that is not even an id in the library filter', async () => {
    const ana = await signIn('Ana');
    const paper = await keep(ana);
    const nobody = '0198a0a0-0000-7000-8000-000000000000';
    for (const id of [nobody, 'not-an-id']) {
      expect((await send('PATCH', `/paper-library/collections/${id}`, ana, { name: 'x' })).status, id).toBe(404);
      expect((await send('DELETE', `/paper-library/collections/${id}`, ana)).status, id).toBe(404);
      expect((await put(ana, id, paper)).status, id).toBe(404);
    }
    expect((await send('GET', `/paper-library?collection=${nobody}`, ana)).status).toBe(404);
    expect((await send('GET', '/paper-library?collection=not-an-id', ana)).status).toBe(400);
  });
});

describe('creating and naming', () => {
  it('creates an empty collection that is private by default and lists it', async () => {
    const ana = await signIn('Ana');
    const res = await send('POST', '/paper-library/collections', ana, { name: 'Distributed systems' });
    expect(res.status).toBe(201);
    const created = await body(res);
    expect(created).toMatchObject({ name: 'Distributed systems', count: 0 });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).not.toHaveProperty('public');
    expect(await collections(ana)).toMatchObject([{ id: created.id, name: 'Distributed systems', count: 0 }]);
    expect(await collections(await signIn('Bob'))).toEqual([]);
  });

  it('trims the name and folds repeated spaces', async () => {
    const ana = await signIn('Ana');
    expect((await make(ana, '  Raft   and \t Paxos  ')).name).toBe('Raft and Paxos');
  });

  it('refuses a blank name, a name that is too long, control characters, a missing name and unknown fields', async () => {
    const ana = await signIn('Ana');
    const post = (data: unknown) => send('POST', '/paper-library/collections', ana, data);

    const blank = await post({ name: '   ' });
    expect(blank.status).toBe(400);
    expect((await body(blank)).code).toBe('name_required');
    const control = await post({ name: 'bad\u0000name' });
    expect(control.status).toBe(400);
    expect((await body(control)).code).toBe('name_invalid');
    expect((await post({ name: 'x'.repeat(81) })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ name: 42 })).status).toBe(400);
    expect((await post({ name: 'ok', public: true })).status).toBe(400);
    expect((await post({ name: 'x'.repeat(80) })).status).toBe(201);
    expect(await collections(ana)).toHaveLength(1);
  });

  it('stores the name as text: markup stays markup', async () => {
    const ana = await signIn('Ana');
    expect((await make(ana, '<script>alert(1)</script>')).name).toBe('<script>alert(1)</script>');
  });

  it('refuses a second collection with the same name, whatever the case, but not for another reader', async () => {
    const ana = await signIn('Ana');
    await make(ana, 'Thesis');
    for (const name of ['Thesis', 'thesis', ' THESIS ']) {
      const res = await send('POST', '/paper-library/collections', ana, { name });
      expect(res.status, name).toBe(409);
      expect((await body(res)).code).toBe('name_taken');
    }
    expect(await names(ana)).toEqual(['Thesis']);
    await make(await signIn('Bob'), 'Thesis');
  });

  it('stops at the limit of collections per reader', async () => {
    const saved = process.env.PAPER_COLLECTIONS_MAX_PER_USER;
    process.env.PAPER_COLLECTIONS_MAX_PER_USER = '2';
    try {
      const ana = await signIn('Ana');
      await make(ana, 'One');
      await make(ana, 'Two');
      const third = await send('POST', '/paper-library/collections', ana, { name: 'Three' });
      expect(third.status).toBe(409);
      expect((await body(third)).code).toBe('collections_limit');
      expect(await make(await signIn('Bob'), 'One')).toMatchObject({ name: 'One' });
    } finally {
      if (saved === undefined) delete process.env.PAPER_COLLECTIONS_MAX_PER_USER;
      else process.env.PAPER_COLLECTIONS_MAX_PER_USER = saved;
    }
  });

  it('renames a collection, also to the same name in another case, and refuses a name that is taken', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    await make(ana, 'Reading group');
    const patch = (id: string, name: string) => send('PATCH', `/paper-library/collections/${id}`, ana, { name });

    const renamed = await patch(thesis.id, ' Dissertation ');
    expect(renamed.status).toBe(200);
    expect(await body(renamed)).toMatchObject({ id: thesis.id, name: 'Dissertation' });
    expect((await patch(thesis.id, 'dissertation')).status).toBe(200);

    const taken = await patch(thesis.id, 'reading GROUP');
    expect(taken.status).toBe(409);
    expect((await body(taken)).code).toBe('name_taken');
    expect((await patch(thesis.id, '  ')).status).toBe(400);
    expect(await names(ana)).toEqual(['dissertation', 'Reading group']);
  });
});

describe('what a collection holds', () => {
  it('holds a paper of the library, once, and counts it', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const paper = await keep(ana);

    const first = await put(ana, thesis.id, paper);
    expect(first.status).toBe(200);
    expect(await body(first)).toMatchObject({ id: thesis.id, name: 'Thesis', count: 1 });
    expect(await body(await put(ana, thesis.id, paper))).toMatchObject({ count: 1 });
    expect(slugs(await browse(ana, `collection=${thesis.id}`))).toEqual([paper]);
  });

  it('refuses a paper that is not in the library, and a paper that does not exist', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const outside = newPaper();

    const notKept = await put(ana, thesis.id, outside);
    expect(notKept.status).toBe(404);
    expect((await put(ana, thesis.id, 'no-such-paper-anywhere')).status).toBe(404);
    expect((await put(ana, thesis.id, '0198a0a0-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await collections(ana))[0].count).toBe(0);
    // The failed attempt did not put the paper in the library either.
    expect((await send('GET', `/paper-library/${outside}`, ana)).status).toBe(404);
  });

  it('lets one paper sit in several collections, and says which on the entry and in the list, by name', async () => {
    const ana = await signIn('Ana');
    const zebra = await make(ana, 'zebra');
    const alpha = await make(ana, 'Alpha');
    const mid = await make(ana, 'Middle');
    const paper = await keep(ana);
    const other = await keep(ana);
    for (const c of [zebra, alpha, mid]) expect((await put(ana, c.id, paper)).status).toBe(200);
    expect((await put(ana, mid.id, other)).status).toBe(200);

    const entry = await body(await send('GET', `/paper-library/${paper}`, ana));
    expect(entry.collections).toEqual([
      { id: alpha.id, name: 'Alpha' },
      { id: mid.id, name: 'Middle' },
      { id: zebra.id, name: 'zebra' },
    ]);
    const all = await browse(ana, '');
    const listed = Object.fromEntries(all.items.map((i) => [i.id, i.library.collections.map((c: any) => c.name)]));
    expect(listed).toEqual({ [paper]: ['Alpha', 'Middle', 'zebra'], [other]: ['Middle'] });

    for (const c of [zebra, alpha, mid]) expect(slugs(await browse(ana, `collection=${c.id}`))).toContain(paper);
    expect(slugs(await browse(ana, `collection=${alpha.id}`))).toEqual([paper]);
    expect((await body(await send('GET', `/paper-library/${other}`, ana))).collections).toEqual([{ id: mid.id, name: 'Middle' }]);
  });

  it('shows a rename on every paper that sits in the collection', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const paper = await keep(ana);
    await put(ana, thesis.id, paper);
    await send('PATCH', `/paper-library/collections/${thesis.id}`, ana, { name: 'Dissertation' });
    expect((await body(await send('GET', `/paper-library/${paper}`, ana))).collections).toEqual([{ id: thesis.id, name: 'Dissertation' }]);
  });

  it('keeps the entry as it was: status, rating and tags are not touched by joining or leaving', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const paper = await keep(ana, newPaper(), 'reading');
    await send('PATCH', `/paper-library/${paper}`, ana, { rating: 4, tags: ['raft'] });
    await put(ana, thesis.id, paper);
    await take(ana, thesis.id, paper);
    expect(await body(await send('GET', `/paper-library/${paper}`, ana))).toMatchObject({ status: 'reading', rating: 4, tags: ['raft'], collections: [] });
  });
});

describe('leaving a collection, and deleting one', () => {
  it('takes a paper out of one collection only, and keeps it in the library and in the others', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const group = await make(ana, 'Reading group');
    const paper = await keep(ana);
    await put(ana, thesis.id, paper);
    await put(ana, group.id, paper);

    expect((await take(ana, thesis.id, paper)).status).toBe(204);
    expect(await collections(ana)).toMatchObject([
      { name: 'Reading group', count: 1 },
      { name: 'Thesis', count: 0 },
    ]);
    expect((await send('GET', `/paper-library/${paper}`, ana)).status).toBe(200);
    expect(slugs(await browse(ana, ''))).toEqual([paper]);
    expect(slugs(await browse(ana, `collection=${group.id}`))).toEqual([paper]);
    expect((await browse(ana, `collection=${thesis.id}`)).total).toBe(0);
  });

  it('answers 204 to taking out a paper that is not in the collection, or not in the library', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const kept = await keep(ana);
    expect((await take(ana, thesis.id, kept)).status).toBe(204);
    expect((await take(ana, thesis.id, newPaper())).status).toBe(204);
  });

  it('deletes a collection without deleting a paper, its PDF or the other collections', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const group = await make(ana, 'Reading group');
    const paper = await keep(ana);
    await put(ana, thesis.id, paper);
    await put(ana, group.id, paper);
    const pdf = makePdf({ padding: 1 });
    const upload = await fetch(`${app.url}/papers/${paper}/attachment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', Cookie: ana },
      body: pdf as BodyInit,
    });
    expect(upload.status).toBe(201);

    expect((await send('DELETE', `/paper-library/collections/${thesis.id}`, ana)).status).toBe(204);

    expect(await collections(ana)).toMatchObject([{ id: group.id, count: 1 }]);
    expect((await send('GET', `/paper-library/${paper}`, ana)).status).toBe(200);
    expect((await body(await send('GET', `/paper-library/${paper}`, ana))).collections).toEqual([{ id: group.id, name: 'Reading group' }]);
    const file = await send('GET', `/papers/${paper}/attachment/file`, ana);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true);
    // Gone for good: the id is no longer a collection.
    expect((await send('GET', `/paper-library?collection=${thesis.id}`, ana)).status).toBe(404);
    expect((await send('DELETE', `/paper-library/collections/${thesis.id}`, ana)).status).toBe(404);
  });

  it('lets a deleted name be used again', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    await send('DELETE', `/paper-library/collections/${thesis.id}`, ana);
    expect((await make(ana, 'thesis')).name).toBe('thesis');
  });

  it('drops a paper from its collections when it leaves the library, and does not bring it back when it returns', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const paper = await keep(ana);
    const staying = await keep(ana);
    await put(ana, thesis.id, paper);
    await put(ana, thesis.id, staying);

    expect((await send('DELETE', `/paper-library/${paper}`, ana)).status).toBe(204);
    expect(await collections(ana)).toMatchObject([{ id: thesis.id, count: 1 }]);
    expect(slugs(await browse(ana, `collection=${thesis.id}`))).toEqual([staying]);

    await keep(ana, paper);
    expect(slugs(await browse(ana, `collection=${thesis.id}`))).toEqual([staying]);
    expect((await body(await send('GET', `/paper-library/${paper}`, ana))).collections).toEqual([]);
  });

  it('removes a reader\'s collections with the reader and touches nobody else\'s', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');
    const anas = await make(ana, 'Thesis');
    const bobs = await make(bob, 'Thesis');
    await put(ana, anas.id, await keep(ana));
    const { id } = await body(await send('GET', '/auth/me', ana));
    await app.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [id]);
    const left: { id: string }[] = await app.dataSource.query(`SELECT id FROM paper_collection WHERE id = ANY($1::uuid[])`, [[anas.id, bobs.id]]);
    expect(left.map((c) => c.id)).toEqual([bobs.id]);
    expect(await app.dataSource.query(`SELECT 1 FROM paper_collection_item WHERE "collectionId" = $1`, [anas.id])).toEqual([]);
  });
});

describe('private papers', () => {
  const manual = async (cookie: string, title: string): Promise<string> => {
    const res = await send('POST', '/paper-library/manual', cookie, { title, authors: [{ name: 'Ada' }], publicationDate: '2020' });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    return (await body(res)).paperId;
  };

  it('collects a paper only the reader has next to the public ones, and goes with it when it is deleted', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const own = await manual(ana, `My own paper ${run}`);
    const pub = await keep(ana);
    expect((await put(ana, thesis.id, own)).status).toBe(200);
    expect((await put(ana, thesis.id, pub)).status).toBe(200);
    expect((await browse(ana, `collection=${thesis.id}`)).total).toBe(2);
    expect((await body(await send('GET', `/paper-library/${own}`, ana))).collections).toEqual([{ id: thesis.id, name: 'Thesis' }]);

    // Deleting the collection leaves the private paper.
    const spare = await make(ana, 'Spare');
    await put(ana, spare.id, own);
    expect((await send('DELETE', `/paper-library/collections/${spare.id}`, ana)).status).toBe(204);
    expect((await send('GET', `/paper-library/${own}`, ana)).status).toBe(200);

    // Deleting the private paper takes it out of the collection, and the public one stays.
    expect((await send('DELETE', `/paper-library/${own}`, ana)).status).toBe(204);
    expect(slugs(await browse(ana, `collection=${thesis.id}`))).toEqual([pub]);
    expect((await collections(ana))[0].count).toBe(1);
  });

  it('does not let another reader put a private paper in a collection', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');
    const own = await manual(ana, `Ana's own paper ${run}`);
    const bobs = await make(bob, 'Mine');
    expect((await put(bob, bobs.id, own)).status).toBe(404);
    expect((await collections(bob))[0].count).toBe(0);
  });
});

describe('order and paging', () => {
  it('lists collections by name ignoring case, then by creation', async () => {
    const ana = await signIn('Ana');
    for (const name of ['beta', 'Gamma', 'alpha', 'Delta']) await make(ana, name);
    expect(await names(ana)).toEqual(['alpha', 'beta', 'Delta', 'Gamma']);
  });

  it('puts the papers of a collection in the library order: newest added first, or by title, rating or finish day', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const [a, b, c, d] = [await keep(ana), await keep(ana), await keep(ana), await keep(ana)];
    // Joined in an order that is neither the order they were added to the library nor the title order.
    for (const paper of [c, a, d]) await put(ana, thesis.id, paper);
    await send('PATCH', `/paper-library/${a}`, ana, { rating: 2 });
    await send('PATCH', `/paper-library/${c}`, ana, { rating: 5 });

    expect(slugs(await browse(ana, `collection=${thesis.id}`))).toEqual([d, c, a]);
    expect(slugs(await browse(ana, `collection=${thesis.id}&sort=title`))).toEqual([a, c, d]);
    expect(slugs(await browse(ana, `collection=${thesis.id}&sort=rating`))).toEqual([c, a, d]);
    expect(slugs(await browse(ana, ''))).toEqual([d, c, b, a]);
  });

  it('combines the collection with the other filters and pages the result', async () => {
    const ana = await signIn('Ana');
    const thesis = await make(ana, 'Thesis');
    const papers = [await keep(ana), await keep(ana, newPaper(), 'reading'), await keep(ana), await keep(ana, newPaper(), 'reading')];
    for (const paper of papers) await put(ana, thesis.id, paper);
    const outside = await keep(ana, newPaper(), 'reading');

    expect((await browse(ana, `collection=${thesis.id}`)).total).toBe(4);
    const reading = await browse(ana, `collection=${thesis.id}&status=reading`);
    expect(slugs(reading)).toEqual([papers[3], papers[1]]);
    expect(slugs(reading)).not.toContain(outside);

    const first = await browse(ana, `collection=${thesis.id}&limit=3`);
    const second = await browse(ana, `collection=${thesis.id}&limit=3&page=2`);
    expect([first.total, first.items.length, second.items.length]).toEqual([4, 3, 1]);
    expect([...slugs(first), ...slugs(second)].sort()).toEqual([...papers].sort());
  });
});
