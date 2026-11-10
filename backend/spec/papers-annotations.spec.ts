import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * Notes and annotations of a library entry (#186). Every test is a request to the real Nest app (its own
 * port, real database, real storage) and an assertion on the response.
 */
const run = Math.random().toString(36).slice(2, 8);
const PAPERS = Array.from({ length: 40 }, (_, i) => ({
  slug: `ann-${run}-${i + 1}`,
  title: `Annotated paper ${i + 1} ${run}`,
}));

let app: AttachmentsApp;
let seq = 0;
/** A public paper nobody has used yet in this run. */
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

const annotations = (paper: string) => `/paper-library/${paper}/annotations`;
const create = (cookie: string, paper: string, body: unknown) => send('POST', annotations(paper), cookie, body);
const list = async (cookie: string, paper: string) => {
  const res = await send('GET', annotations(paper), cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as { version: number | null; items: any[] };
};

const upload = (cookie: string, paper: string, pdf: Buffer) =>
  fetch(`${app.url}/papers/${paper}/attachment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', Cookie: cookie },
    body: pdf as BodyInit,
  });

/** The reader keeps the paper and has a PDF on it (version 1 of `pdf`). */
async function reader(name: string, pdf = makePdf({ padding: 1 })) {
  const cookie = await signIn(name);
  const paper = newPaper();
  expect((await send('POST', '/paper-library', cookie, { paperId: paper })).status).toBe(201);
  expect((await upload(cookie, paper, pdf)).status).toBe(201);
  return { cookie, paper };
}

const RECT = { x: 0.1, y: 0.2, w: 0.5, h: 0.03 };
const highlight = (version = 1, extra: object = {}) => ({
  kind: 'highlight',
  version,
  page: 2,
  quote: 'the quorum is a majority',
  prefix: 'In Raft, ',
  suffix: ' of the servers',
  rects: [RECT],
  ...extra,
});

beforeAll(async () => {
  app = await startAttachmentsApp({ maxBytes: 200_000, quotaBytes: 600_000 }, PAPERS);
});

afterAll(async () => {
  await app.dataSource.query(`DELETE FROM paper_attachment WHERE "paperSlug" LIKE $1`, [`ann-${run}-%`]);
  await app.maintain();
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [`% ${run}`]);
  await app.close();
});

describe('who can reach them', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['PATCH', '/0192f0c8-0000-7000-8000-000000000000'],
    ['DELETE', '/0192f0c8-0000-7000-8000-000000000000'],
  ])('answers 401 to %s without a session', async (method, tail) => {
    const res = await send(method, annotations(PAPERS[0].slug) + tail, undefined, method === 'POST' || method === 'PATCH' ? { kind: 'note', body: 'x' } : undefined);
    expect(res.status).toBe(401);
  });

  it('answers 404 for a paper that is not in the reader library, on every route', async () => {
    const cookie = await signIn('Stranger');
    const paper = newPaper();
    const id = '0192f0c8-0000-7000-8000-000000000000';
    expect((await send('GET', annotations(paper), cookie)).status).toBe(404);
    expect((await create(cookie, paper, { kind: 'note', body: 'x' })).status).toBe(404);
    expect((await send('PATCH', `${annotations(paper)}/${id}`, cookie, { body: 'x' })).status).toBe(404);
    expect((await send('DELETE', `${annotations(paper)}/${id}`, cookie)).status).toBe(404);
  });

  it('keeps one reader out of another reader notes, even on the same paper', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');
    const paper = newPaper();
    for (const cookie of [ana, bob]) await send('POST', '/paper-library', cookie, { paperId: paper });
    const made = await (await create(ana, paper, { kind: 'note', body: 'only for Ana' })).json();

    expect((await list(bob, paper)).items).toEqual([]);
    expect((await send('PATCH', `${annotations(paper)}/${made.id}`, bob, { body: 'hijacked' })).status).toBe(404);
    expect((await send('DELETE', `${annotations(paper)}/${made.id}`, bob)).status).toBe(404);
    expect((await list(ana, paper)).items.map((i) => i.body)).toEqual(['only for Ana']);
  });

  it('keeps the notes of a private paper to its owner', async () => {
    const ana = await signIn('Ana private');
    const bob = await signIn('Bob private');
    const made = await send('POST', '/paper-library/manual', ana, { title: `Mine ${run}`, authors: [{ name: 'Ada' }], publicationDate: '2020' });
    expect(made.status).toBe(201);
    const { paperId } = (await made.json()) as { paperId: string };

    expect((await create(ana, paperId, { kind: 'note', body: 'my own paper' })).status).toBe(201);
    expect((await list(ana, paperId)).items).toHaveLength(1);
    expect((await send('GET', annotations(paperId), bob)).status).toBe(404);
  });
});

describe('notes', () => {
  it('are created, listed, edited and deleted, and a note has no place in the PDF', async () => {
    const cookie = await signIn('Noter');
    const paper = newPaper();
    await send('POST', '/paper-library', cookie, { paperId: paper });

    const res = await create(cookie, paper, { kind: 'note', body: '  Read the proof twice.  ' });
    expect(res.status).toBe(201);
    const note = await res.json();
    expect(note).toMatchObject({
      kind: 'note',
      body: 'Read the proof twice.',
      page: null,
      quote: null,
      rects: null,
      pdfVersion: null,
      stale: false,
    });
    expect(note.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    expect(await list(cookie, paper)).toMatchObject({ version: null, items: [{ id: note.id, body: 'Read the proof twice.' }] });

    const edited = await send('PATCH', `${annotations(paper)}/${note.id}`, cookie, { body: 'Read it three times.' });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ id: note.id, kind: 'note', body: 'Read it three times.' });

    expect((await send('DELETE', `${annotations(paper)}/${note.id}`, cookie)).status).toBe(204);
    expect((await list(cookie, paper)).items).toEqual([]);
    expect((await send('DELETE', `${annotations(paper)}/${note.id}`, cookie)).status).toBe(404);
  });

  it.each([
    ['no text', { kind: 'note' }],
    ['only spaces', { kind: 'note', body: '   ' }],
    ['a page', { kind: 'note', body: 'x', page: 1 }],
    ['a quote', { kind: 'note', body: 'x', quote: 'q' }],
    ['a version', { kind: 'note', body: 'x', version: 1 }],
  ])('refuses a note with %s', async (_label, body) => {
    const cookie = await signIn('Noter bad');
    const paper = newPaper();
    await send('POST', '/paper-library', cookie, { paperId: paper });
    const res = await create(cookie, paper, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: expect.stringMatching(/note_/) });
  });

  it('refuses a note of more than 5000 characters, one with a NUL, an unknown kind and an unknown field', async () => {
    const cookie = await signIn('Noter limits');
    const paper = newPaper();
    await send('POST', '/paper-library', cookie, { paperId: paper });
    expect((await create(cookie, paper, { kind: 'note', body: 'x'.repeat(5001) })).status).toBe(400);
    expect((await create(cookie, paper, { kind: 'note', body: 'a\u0000b' })).status).toBe(400);
    expect((await create(cookie, paper, { kind: 'scribble', body: 'x' })).status).toBe(400);
    expect((await create(cookie, paper, { kind: 'note', body: 'x', owner: 1 })).status).toBe(400);
    expect((await create(cookie, paper, { kind: 'note', body: 'x'.repeat(5000) })).status).toBe(201);
    expect((await send('PATCH', `${annotations(paper)}/not-a-uuid`, cookie, { body: 'x' })).status).toBe(404);
  });

  it('keeps what was typed as text: the server never makes HTML of it', async () => {
    const cookie = await signIn('Noter xss');
    const paper = newPaper();
    await send('POST', '/paper-library', cookie, { paperId: paper });
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)> [x](javascript:alert(3))';

    const res = await create(cookie, paper, { kind: 'note', body: payload });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).body).toBe(payload);
    expect((await list(cookie, paper)).items[0].body).toBe(payload);
  });

  it('are kept when the entry changes and when the PDF goes, and go with the paper leaving the library', async () => {
    const { cookie, paper } = await reader('Keeper');
    const note = await (await create(cookie, paper, { kind: 'note', body: 'stays' })).json();

    expect((await send('PATCH', `/paper-library/${paper}`, cookie, { status: 'reading', rating: 4, tags: ['raft'] })).status).toBe(200);
    expect((await send('DELETE', `/papers/${paper}/attachment`, cookie)).status).toBe(204);
    expect((await list(cookie, paper)).items.map((i) => i.id)).toEqual([note.id]);

    expect((await send('DELETE', `/paper-library/${paper}`, cookie)).status).toBe(204);
    expect((await send('GET', annotations(paper), cookie)).status).toBe(404);
    const rows = await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation WHERE id = $1`, [note.id]);
    expect(rows[0].n).toBe(0);
  });

  it('stops at the limit per entry with a stable code', async () => {
    const cookie = await signIn('Limited');
    const paper = newPaper();
    await send('POST', '/paper-library', cookie, { paperId: paper });
    process.env.PAPER_ANNOTATIONS_MAX_PER_ENTRY = '2';
    try {
      expect((await create(cookie, paper, { kind: 'note', body: '1' })).status).toBe(201);
      expect((await create(cookie, paper, { kind: 'note', body: '2' })).status).toBe(201);
      const res = await create(cookie, paper, { kind: 'note', body: '3' });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'annotations_limit' });
    } finally {
      delete process.env.PAPER_ANNOTATIONS_MAX_PER_ENTRY;
    }
  });
});

describe('annotations on the PDF', () => {
  it('a highlight keeps the text, its context and where it is, and comes back as made', async () => {
    const { cookie, paper } = await reader('Highlighter');

    const res = await create(cookie, paper, highlight());

    expect(res.status).toBe(201);
    const made = await res.json();
    expect(made).toMatchObject({
      kind: 'highlight',
      body: null,
      page: 2,
      quote: 'the quorum is a majority',
      prefix: 'In Raft, ',
      suffix: ' of the servers',
      rects: [RECT],
      pdfVersion: 1,
      stale: false,
    });
    expect(await list(cookie, paper)).toMatchObject({ version: 1, items: [{ id: made.id, rects: [RECT], stale: false }] });
  });

  it('a comment, a question and a bookmark are made the same way, with the text each one needs', async () => {
    const { cookie, paper } = await reader('Commenter');

    const comment = await create(cookie, paper, highlight(1, { kind: 'comment', body: 'Why a majority?' }));
    const question = await create(cookie, paper, { kind: 'question', version: 1, page: 3, body: 'Does this hold with 2 nodes?' });
    const bookmark = await create(cookie, paper, { kind: 'bookmark', version: 1, page: 5, body: 'Proof of safety' });
    const bare = await create(cookie, paper, { kind: 'bookmark', version: 1, page: 6 });

    expect(comment.status).toBe(201);
    expect(await comment.json()).toMatchObject({ kind: 'comment', body: 'Why a majority?', quote: 'the quorum is a majority' });
    expect(question.status).toBe(201);
    expect(await question.json()).toMatchObject({ kind: 'question', page: 3, quote: null, rects: null });
    expect(bookmark.status).toBe(201);
    expect(await bookmark.json()).toMatchObject({ kind: 'bookmark', page: 5, body: 'Proof of safety' });
    expect(bare.status).toBe(201);
    expect(await bare.json()).toMatchObject({ kind: 'bookmark', page: 6, body: null });
    expect((await list(cookie, paper)).items).toHaveLength(4);
  });

  it.each([
    ['a highlight without the selected text', highlight(1, { quote: undefined }), 'highlight_needs_text'],
    ['a highlight without its position', highlight(1, { rects: undefined }), 'highlight_needs_text'],
    ['a comment without text', { kind: 'comment', version: 1, page: 1 }, 'body_required'],
    ['a question with only spaces', { kind: 'question', version: 1, page: 1, body: '  ' }, 'body_required'],
    ['a bookmark with a selection', { kind: 'bookmark', version: 1, page: 1, quote: 'x', rects: [RECT] }, 'bookmark_is_a_page'],
    ['a bookmark label that is too long', { kind: 'bookmark', version: 1, page: 1, body: 'x'.repeat(201) }, 'label_too_long'],
    ['no page', { kind: 'bookmark', version: 1 }, 'anchor_required'],
    ['no version', { kind: 'bookmark', page: 1 }, 'anchor_required'],
  ])('refuses %s', async (_label, body, code) => {
    const { cookie, paper } = await reader('Strict');
    const res = await create(cookie, paper, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code });
  });

  it.each([
    ['a rectangle outside the page', { rects: [{ x: 1.2, y: 0, w: 0.1, h: 0.1 }] }],
    ['a negative size', { rects: [{ x: 0, y: 0, w: -0.1, h: 0.1 }] }],
    ['a rectangle that is not numbers', { rects: [{ x: 'a', y: 0, w: 0.1, h: 0.1 }] }],
    ['more than 100 rectangles', { rects: Array.from({ length: 101 }, () => RECT) }],
    ['page 0', { page: 0 }],
    ['a quote of more than 2000 characters', { quote: 'q'.repeat(2001) }],
    ['a context of more than 200 characters', { prefix: 'p'.repeat(201) }],
  ])('refuses %s', async (_label, extra) => {
    const { cookie, paper } = await reader('Strict shapes');
    expect((await create(cookie, paper, highlight(1, extra))).status).toBe(400);
  });

  it('refuses an annotation for a paper with no PDF', async () => {
    const cookie = await signIn('No pdf');
    const paper = newPaper();
    await send('POST', '/paper-library', cookie, { paperId: paper });
    const res = await create(cookie, paper, highlight());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'no_pdf' });
  });

  it('refuses an annotation made on a PDF that is no longer the one served, and says which is', async () => {
    const { cookie, paper } = await reader('Late', makePdf({ padding: 1 }));
    expect((await upload(cookie, paper, makePdf({ padding: 2 }))).status).toBe(200);

    const res = await create(cookie, paper, highlight(1));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'stale_version', version: 2 });
    expect((await create(cookie, paper, highlight(2))).status).toBe(201);
  });

  it('keeps the annotations of the old PDF as they were and marks them stale, never moving them', async () => {
    const original = makePdf({ padding: 1 });
    const { cookie, paper } = await reader('Replacer', original);
    const made = await (await create(cookie, paper, highlight())).json();

    expect((await upload(cookie, paper, makePdf({ padding: 2 }))).status).toBe(200);

    const after = await list(cookie, paper);
    expect(after.version).toBe(2);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ id: made.id, stale: true, pdfVersion: 1, page: 2, quote: 'the quorum is a majority', rects: [RECT] });

    // The very same file comes back: the annotations were made on exactly this content, so they hold again.
    expect((await upload(cookie, paper, original)).status).toBe(200);
    const back = await list(cookie, paper);
    expect(back.version).toBe(3);
    expect(back.items[0]).toMatchObject({ id: made.id, stale: false, pdfVersion: 1 });
  });

  it('marks them stale when the PDF is removed, and keeps them', async () => {
    const { cookie, paper } = await reader('Remover');
    await create(cookie, paper, highlight());
    await create(cookie, paper, { kind: 'bookmark', version: 1, page: 4 });

    expect((await send('DELETE', `/papers/${paper}/attachment`, cookie)).status).toBe(204);

    const after = await list(cookie, paper);
    expect(after.version).toBeNull();
    expect(after.items.map((i) => i.stale)).toEqual([true, true]);
  });

  it('a stale annotation can be kept as a note, with its quote and what it said', async () => {
    const { cookie, paper } = await reader('Settler', makePdf({ padding: 1 }));
    const made = await (await create(cookie, paper, highlight(1, { kind: 'comment', body: 'Why a majority?' }))).json();

    // While the PDF is the same it cannot be turned into a note.
    const early = await send('PATCH', `${annotations(paper)}/${made.id}`, cookie, { kind: 'note' });
    expect(early.status).toBe(400);
    expect(await early.json()).toMatchObject({ code: 'not_stale' });

    expect((await upload(cookie, paper, makePdf({ padding: 2 }))).status).toBe(200);
    const res = await send('PATCH', `${annotations(paper)}/${made.id}`, cookie, { kind: 'note' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: made.id,
      kind: 'note',
      body: '> the quorum is a majority\n\nWhy a majority?',
      page: null,
      quote: null,
      rects: null,
      pdfVersion: null,
      stale: false,
    });
  });

  it('edits the text of a comment but never the anchor, and refuses to empty a comment', async () => {
    const { cookie, paper } = await reader('Editor');
    const made = await (await create(cookie, paper, highlight(1, { kind: 'comment', body: 'first' }))).json();

    const edited = await send('PATCH', `${annotations(paper)}/${made.id}`, cookie, { body: 'second' });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ body: 'second', page: 2, rects: [RECT], quote: 'the quorum is a majority' });

    expect((await send('PATCH', `${annotations(paper)}/${made.id}`, cookie, { body: ' ' })).status).toBe(400);
    expect((await send('PATCH', `${annotations(paper)}/${made.id}`, cookie, { page: 9 })).status).toBe(400);
    expect((await send('PATCH', `${annotations(paper)}/${made.id}`, cookie, { rects: [] })).status).toBe(400);

    // A highlight may lose its comment: it is still a highlight.
    const hl = await (await create(cookie, paper, highlight())).json();
    expect((await send('PATCH', `${annotations(paper)}/${hl.id}`, cookie, { body: 'now with words' })).status).toBe(200);
    const cleared = await send('PATCH', `${annotations(paper)}/${hl.id}`, cookie, { body: '' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ kind: 'highlight', body: null });
  });

  it('deletes with the paper when the reader removes a private paper', async () => {
    const cookie = await signIn('Private deleter');
    const made = await send('POST', '/paper-library/manual', cookie, { title: `Gone ${run}`, authors: [{ name: 'Ada' }], publicationDate: '2019' });
    const { paperId } = (await made.json()) as { paperId: string };
    const note = await (await create(cookie, paperId, { kind: 'note', body: 'bye' })).json();

    expect((await send('DELETE', `/paper-library/${paperId}`, cookie)).status).toBe(204);

    const rows = await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation WHERE id = $1`, [note.id]);
    expect(rows[0].n).toBe(0);
  });
});
