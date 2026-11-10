import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * Sharing annotations on purpose (#187). Every test is a request to the real Nest app (its own port, real
 * database, real storage) and an assertion on the response, from the side of the owner, of a recipient, of
 * a reader who was not named and of a visitor who is not signed in.
 */
const run = Math.random().toString(36).slice(2, 8);
const PAPERS = Array.from({ length: 40 }, (_, i) => ({
  slug: `shr-${run}-${i + 1}`,
  title: `Shared paper ${i + 1} ${run}`,
}));

let app: AttachmentsApp;
let seq = 0;
let readers = 0;
const newPaper = () => PAPERS[seq++].slug;

interface Reader {
  cookie: string;
  id: number;
  /** The id of the public profile, which is what other readers name a recipient by. */
  profile: string;
  slug: string;
}

async function signIn(name: string): Promise<Reader> {
  const res = await fetch(`${app.url}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `${name} ${run}` }),
  });
  expect(res.status).toBe(201);
  const cookie = (res.headers.getSetCookie()[0] ?? '').split(';')[0];
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}-${run}-${readers++}`;
  expect((await send('PUT', '/auth/profile-slug', cookie, { slug })).status).toBe(200);
  const me = (await (await send('GET', '/auth/me', cookie)).json()) as { id: number; publicProfileId: string };
  return { cookie, id: me.id, profile: me.publicProfileId, slug };
}

const send = (method: string, path: string, cookie?: string, data?: unknown) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

const annotations = (paper: string) => `/paper-library/${paper}/annotations`;
const shareUrl = (paper: string, id: string) => `${annotations(paper)}/${id}/share`;
const upload = (cookie: string, paper: string, pdf: Buffer) =>
  fetch(`${app.url}/papers/${paper}/attachment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', Cookie: cookie },
    body: pdf as BodyInit,
  });

const highlight = (extra: object = {}) => ({
  kind: 'highlight',
  version: 1,
  page: 3,
  quote: 'the quorum is a majority',
  prefix: 'In Raft, ',
  suffix: ' of the servers',
  rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.03 }],
  ...extra,
});

/** A reader with a paper in the library and a PDF on it. */
async function reader(name: string, paper = newPaper()) {
  const who = await signIn(name);
  expect((await send('POST', '/paper-library', who.cookie, { paperId: paper })).status).toBe(201);
  expect((await upload(who.cookie, paper, makePdf({ padding: 1 }))).status).toBe(201);
  return { ...who, paper };
}

async function make(cookie: string, paper: string, body: object): Promise<any> {
  const res = await send('POST', annotations(paper), cookie, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return res.json();
}

const share = (cookie: string, paper: string, id: string, body: object) => send('PUT', shareUrl(paper, id), cookie, body);
const shared = async (paper: string, cookie?: string): Promise<any[]> => {
  const res = await send('GET', `/papers/${paper}/shared-annotations`, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: any[] }).items;
};
const mine = async (cookie: string, paper: string, id: string) => {
  const items = ((await (await send('GET', annotations(paper), cookie)).json()) as { items: any[] }).items;
  return items.find((i) => i.id === id);
};

beforeAll(async () => {
  app = await startAttachmentsApp({ maxBytes: 200_000, quotaBytes: 600_000 }, PAPERS);
});

afterAll(async () => {
  await app.dataSource.query(`DELETE FROM paper_attachment WHERE "paperSlug" LIKE $1`, [`shr-${run}-%`]);
  await app.maintain();
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [`% ${run}`]);
  await app.close();
});

describe('nothing is shared until the reader says so', () => {
  it('lists nothing for anyone while every annotation is private, and says so on the annotation', async () => {
    const ana = await reader('Ana');
    const made = await make(ana.cookie, ana.paper, highlight());
    await make(ana.cookie, ana.paper, { kind: 'note', body: 'private thought' });

    expect(await shared(ana.paper)).toEqual([]);
    expect(await shared(ana.paper, ana.cookie)).toEqual([]);
    expect((await mine(ana.cookie, ana.paper, made.id)).share).toBeNull();
  });

  it('answers 401 to a signed-out share or unshare, and lists for a visitor without asking who they are', async () => {
    const ana = await reader('Ana401');
    const made = await make(ana.cookie, ana.paper, highlight());

    expect((await send('PUT', shareUrl(ana.paper, made.id), undefined, { visibility: 'public' })).status).toBe(401);
    expect((await send('DELETE', shareUrl(ana.paper, made.id))).status).toBe(401);
    expect((await send('GET', `/papers/${ana.paper}/shared-annotations`)).status).toBe(200);
  });

  it('answers 404 for a paper that is unknown or a private one', async () => {
    const ana = await signIn('Ana404');
    expect((await send('GET', `/papers/no-such-paper-${run}/shared-annotations`)).status).toBe(404);
    expect((await send('GET', '/papers/0192f0c8-0000-7000-8000-000000000000/shared-annotations', ana.cookie)).status).toBe(404);
  });
});

describe('sharing with everyone', () => {
  it('publishes a copy with the author, the page and the quote, and nothing of the private side', async () => {
    const ana = await reader('Ana Public');
    const made = await make(ana.cookie, ana.paper, highlight());
    await make(ana.cookie, ana.paper, highlight({ quote: 'a second, private highlight' }));
    await make(ana.cookie, ana.paper, { kind: 'note', body: 'still private' });

    const res = await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ visibility: 'public', recipients: [] });

    const items = await shared(ana.paper);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: expect.any(String),
      kind: 'highlight',
      body: null,
      page: 3,
      quote: 'the quorum is a majority',
      visibility: 'public',
      mine: false,
      author: { name: `Ana Public ${run}`, avatarUrl: expect.any(String), profile: ana.slug },
      sharedAt: expect.any(String),
    });
    // The id of the copy is not the id of the annotation, so it opens no door to the private side.
    expect(items[0].id).not.toBe(made.id);
    expect(JSON.stringify(items)).not.toMatch(/rects|prefix|suffix|pdfVersion|pdfSha256|annotationId|entryId|In Raft/);
    expect(items[0].quote).not.toContain('private');
  });

  it('shows the same to a signed-in reader who was not named, and marks the author own copy as theirs', async () => {
    const ana = await reader('Ana Mine');
    const eve = await signIn('Eve Mine');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    expect((await shared(ana.paper, eve.cookie)).map((i) => i.mine)).toEqual([false]);
    expect((await shared(ana.paper, ana.cookie)).map((i) => i.mine)).toEqual([true]);
  });

  it('shares a free-form note too, without a page', async () => {
    const ana = await reader('Ana Note');
    const note = await make(ana.cookie, ana.paper, { kind: 'note', body: 'Read this one **first**' });
    expect((await share(ana.cookie, ana.paper, note.id, { visibility: 'public' })).status).toBe(200);

    expect(await shared(ana.paper)).toMatchObject([{ kind: 'note', body: 'Read this one **first**', page: null, quote: null }]);
  });

  it('shares a comment and a question with their text', async () => {
    const ana = await reader('Ana Talk');
    const comment = await make(ana.cookie, ana.paper, highlight({ kind: 'comment', body: 'Why a majority?' }));
    const question = await make(ana.cookie, ana.paper, highlight({ kind: 'question', body: 'Is this safe?', page: 1 }));
    for (const a of [comment, question]) expect((await share(ana.cookie, ana.paper, a.id, { visibility: 'public' })).status).toBe(200);

    expect((await shared(ana.paper)).map((i) => [i.kind, i.page, i.body])).toEqual([
      ['question', 1, 'Is this safe?'],
      ['comment', 3, 'Why a majority?'],
    ]);
  });

  it('cuts a long passage to a few lines, never inside a character', async () => {
    const ana = await reader('Ana Long');
    const long = `${'word '.repeat(98)}😀😀😀😀😀😀`.repeat(3).slice(0, 1500);
    const made = await make(ana.cookie, ana.paper, highlight({ quote: long }));
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    const [item] = await shared(ana.paper);
    expect(Array.from(item.quote as string).length).toBeLessThanOrEqual(501);
    expect(item.quote.endsWith('…')).toBe(true);
    expect(item.quote).not.toMatch(/[\uD800-\uDBFF]$/);
    // The private annotation keeps all of it.
    expect((await mine(ana.cookie, ana.paper, made.id)).quote).toBe(long);
  });

  it('stores what was typed as text, so a script in a shared note is only text', async () => {
    const ana = await reader('Ana Xss');
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const note = await make(ana.cookie, ana.paper, { kind: 'note', body: payload });
    await share(ana.cookie, ana.paper, note.id, { visibility: 'public' });

    expect((await shared(ana.paper))[0].body).toBe(payload);
  });

  it('is not cached, so taking it back is the next request', async () => {
    const ana = await reader('Ana Cache');
    const res = await send('GET', `/papers/${ana.paper}/shared-annotations`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('lists only the shares of the paper asked for', async () => {
    const ana = await reader('Ana TwoPapers');
    const other = newPaper();
    await send('POST', '/paper-library', ana.cookie, { paperId: other });
    const a = await make(ana.cookie, ana.paper, { kind: 'note', body: 'on the first' });
    const b = await make(ana.cookie, other, { kind: 'note', body: 'on the second' });
    await share(ana.cookie, ana.paper, a.id, { visibility: 'public' });
    await share(ana.cookie, other, b.id, { visibility: 'public' });

    expect((await shared(ana.paper)).map((i) => i.body)).toEqual(['on the first']);
    expect((await shared(other)).map((i) => i.body)).toEqual(['on the second']);
  });
});

describe('sharing with chosen readers', () => {
  it('shows it to the readers named and to nobody else, whatever they are called by', async () => {
    const ana = await reader('Ana Chosen');
    const bob = await signIn('Bob Chosen');
    const cat = await signIn('Cat Chosen');
    const dan = await signIn('Dan Chosen');
    const eve = await signIn('Eve Chosen');
    const made = await make(ana.cookie, ana.paper, highlight());

    const res = await share(ana.cookie, ana.paper, made.id, {
      visibility: 'users',
      recipients: [bob.slug.toUpperCase(), cat.profile, `https://example.org/u/${dan.slug}/`],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.visibility).toBe('users');
    expect(body.recipients.map((r: any) => r.id).sort()).toEqual([bob.profile, cat.profile, dan.profile].sort());

    for (const who of [bob, cat, dan]) {
      expect((await shared(ana.paper, who.cookie)).map((i) => [i.visibility, i.mine]), who.slug).toEqual([['users', false]]);
    }
    expect(await shared(ana.paper, eve.cookie)).toEqual([]);
    expect(await shared(ana.paper)).toEqual([]);
    expect((await shared(ana.paper, ana.cookie)).map((i) => i.mine)).toEqual([true]);
    expect((await mine(ana.cookie, ana.paper, made.id)).share.recipients).toHaveLength(3);
  });

  it('shows the paper page, not the PDF: a recipient gets no access to the file', async () => {
    const ana = await reader('Ana NoFile');
    const bob = await signIn('Bob NoFile');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'users', recipients: [bob.slug] });

    expect((await shared(ana.paper, bob.cookie)).length).toBe(1);
    expect((await send('GET', `/papers/${ana.paper}/attachment`, bob.cookie)).status).toBe(404);
    expect((await send('GET', `/papers/${ana.paper}/attachment/file`, bob.cookie)).status).toBe(404);
    expect((await send('GET', annotations(ana.paper), bob.cookie)).status).toBe(404);
  });

  it.each([
    ['nobody', ['nobody-has-this-name']],
    ['a malformed name', ['!!']],
    ['nobody else but a blank', ['   ']],
  ])('refuses %s as a recipient with 400 recipient_not_found', async (_label, recipients) => {
    const ana = await reader(`Ana Nf${seq}`);
    const made = await make(ana.cookie, ana.paper, highlight());
    const res = await share(ana.cookie, ana.paper, made.id, { visibility: 'users', recipients });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'recipient_not_found' });
    expect(await shared(ana.paper, ana.cookie)).toEqual([]);
  });

  it('answers the same for a reader whose profile is not public as for one who does not exist', async () => {
    const ana = await reader('Ana Hidden');
    const bob = await signIn('Bob Hidden');
    expect((await send('PUT', '/auth/settings', bob.cookie, { profilePublic: false })).status).toBe(200);
    const made = await make(ana.cookie, ana.paper, highlight());

    for (const name of [bob.slug, bob.profile]) {
      const res = await share(ana.cookie, ana.paper, made.id, { visibility: 'users', recipients: [name] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'recipient_not_found' });
    }
  });

  it('refuses the author as a recipient, no recipients for chosen readers, and recipients for a public share', async () => {
    const ana = await reader('Ana Rules');
    const bob = await signIn('Bob Rules');
    const made = await make(ana.cookie, ana.paper, highlight());
    const code = async (body: object) => ((await (await share(ana.cookie, ana.paper, made.id, body)).json()) as any).code;

    expect(await code({ visibility: 'users', recipients: [ana.slug] })).toBe('recipient_is_you');
    expect(await code({ visibility: 'users' })).toBe('recipients_required');
    expect(await code({ visibility: 'users', recipients: [] })).toBe('recipients_required');
    expect(await code({ visibility: 'public', recipients: [bob.slug] })).toBe('recipients_only_for_users');
  });

  it.each([
    ['an unknown visibility', { visibility: 'friends' }],
    ['a missing visibility', {}],
    ['an unknown field', { visibility: 'public', owner: 1 }],
    ['recipients that are not text', { visibility: 'users', recipients: [1] }],
    ['the same recipient twice', { visibility: 'users', recipients: ['a-b-c', 'a-b-c'] }],
    ['more than 20 recipients', { visibility: 'users', recipients: Array.from({ length: 21 }, (_, i) => `reader-${i}`) }],
  ])('answers 400 to %s', async (_label, body) => {
    const ana = await reader(`Ana Val${seq}`);
    const made = await make(ana.cookie, ana.paper, highlight());
    expect((await share(ana.cookie, ana.paper, made.id, body)).status).toBe(400);
    expect(await shared(ana.paper)).toEqual([]);
  });

  it('counts the same reader named two ways once', async () => {
    const ana = await reader('Ana Dup');
    const bob = await signIn('Bob Dup');
    const made = await make(ana.cookie, ana.paper, highlight());
    const res = await share(ana.cookie, ana.paper, made.id, { visibility: 'users', recipients: [bob.slug, bob.profile] });
    expect(res.status).toBe(200);
    expect((await res.json()).recipients).toHaveLength(1);
  });
});

describe('who can share, change and take back', () => {
  it('lets only the author do it: another reader gets 404, even with the same paper in their library', async () => {
    const ana = await reader('Ana Own');
    const bob = await signIn('Bob Own');
    await send('POST', '/paper-library', bob.cookie, { paperId: ana.paper });
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    expect((await share(bob.cookie, ana.paper, made.id, { visibility: 'users', recipients: [ana.slug] })).status).toBe(404);
    expect((await send('DELETE', shareUrl(ana.paper, made.id), bob.cookie)).status).toBe(404);
    expect((await shared(ana.paper)).map((i) => i.visibility)).toEqual(['public']);
  });

  it('answers 404 for an annotation that is not there, and for a paper that is not in the library', async () => {
    const ana = await reader('Ana Gone');
    const bob = await signIn('Bob Gone');
    const id = '0192f0c8-0000-7000-8000-000000000000';
    expect((await share(ana.cookie, ana.paper, id, { visibility: 'public' })).status).toBe(404);
    expect((await share(ana.cookie, ana.paper, 'not-an-id', { visibility: 'public' })).status).toBe(404);
    expect((await share(bob.cookie, ana.paper, id, { visibility: 'public' })).status).toBe(404);
  });

  it('does not share a bookmark', async () => {
    const ana = await reader('Ana Mark');
    const mark = await make(ana.cookie, ana.paper, { kind: 'bookmark', version: 1, page: 2 });
    const res = await share(ana.cookie, ana.paper, mark.id, { visibility: 'public' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'not_shareable' });
  });

  it('does not share on a private paper, which has no page to share on', async () => {
    const ana = await signIn('Ana Priv');
    const made = await send('POST', '/paper-library/manual', ana.cookie, { title: `Mine ${run}`, authors: [{ name: 'Ada' }], publicationDate: '2020' });
    expect(made.status).toBe(201);
    const { paperId } = (await made.json()) as { paperId: string };
    const note = await make(ana.cookie, paperId, { kind: 'note', body: 'about my own paper' });

    const res = await share(ana.cookie, paperId, note.id, { visibility: 'public' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'private_paper' });
    expect((await send('GET', `/papers/${paperId}/shared-annotations`, ana.cookie)).status).toBe(404);
  });

  it('keeps at most PAPER_SHARES_MAX_PER_USER shares, and a share can still be changed at the limit', async () => {
    const ana = await reader('Ana Cap');
    const saved = process.env.PAPER_SHARES_MAX_PER_USER;
    process.env.PAPER_SHARES_MAX_PER_USER = '2';
    try {
      const a = await make(ana.cookie, ana.paper, highlight());
      const b = await make(ana.cookie, ana.paper, highlight({ quote: 'second' }));
      const c = await make(ana.cookie, ana.paper, highlight({ quote: 'third' }));
      expect((await share(ana.cookie, ana.paper, a.id, { visibility: 'public' })).status).toBe(200);
      expect((await share(ana.cookie, ana.paper, b.id, { visibility: 'public' })).status).toBe(200);
      const over = await share(ana.cookie, ana.paper, c.id, { visibility: 'public' });
      expect(over.status).toBe(409);
      expect(await over.json()).toMatchObject({ code: 'shares_limit' });
      expect((await share(ana.cookie, ana.paper, a.id, { visibility: 'public' })).status).toBe(200);
      expect((await send('DELETE', shareUrl(ana.paper, a.id), ana.cookie)).status).toBe(204);
      expect((await share(ana.cookie, ana.paper, c.id, { visibility: 'public' })).status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.PAPER_SHARES_MAX_PER_USER;
      else process.env.PAPER_SHARES_MAX_PER_USER = saved;
    }
  });
});

describe('revoking', () => {
  it('takes the copy away from everyone at once, and unsharing again is fine', async () => {
    const ana = await reader('Ana Revoke');
    const bob = await signIn('Bob Revoke');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });
    expect((await shared(ana.paper, bob.cookie)).length).toBe(1);

    expect((await send('DELETE', shareUrl(ana.paper, made.id), ana.cookie)).status).toBe(204);
    expect(await shared(ana.paper)).toEqual([]);
    expect(await shared(ana.paper, bob.cookie)).toEqual([]);
    expect(await shared(ana.paper, ana.cookie)).toEqual([]);
    expect((await mine(ana.cookie, ana.paper, made.id)).share).toBeNull();
    expect((await send('DELETE', shareUrl(ana.paper, made.id), ana.cookie)).status).toBe(204);
    // The private annotation is untouched.
    expect((await mine(ana.cookie, ana.paper, made.id)).quote).toBe('the quorum is a majority');
  });

  it('takes the copy away from the readers it named, who see it no more', async () => {
    const ana = await reader('Ana RevokeUsers');
    const bob = await signIn('Bob RevokeUsers');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'users', recipients: [bob.slug] });
    expect((await shared(ana.paper, bob.cookie)).length).toBe(1);

    await send('DELETE', shareUrl(ana.paper, made.id), ana.cookie);
    expect(await shared(ana.paper, bob.cookie)).toEqual([]);
    const left = await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation_share_recipient WHERE "userId" = $1`, [bob.id]);
    expect(left[0].n).toBe(0);
  });

  it('changes the audience when it is shared again: from everyone to chosen readers and back', async () => {
    const ana = await reader('Ana Again');
    const bob = await signIn('Bob Again');
    const eve = await signIn('Eve Again');
    const made = await make(ana.cookie, ana.paper, highlight());

    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });
    expect((await shared(ana.paper)).length).toBe(1);

    await share(ana.cookie, ana.paper, made.id, { visibility: 'users', recipients: [bob.slug] });
    expect(await shared(ana.paper)).toEqual([]);
    expect(await shared(ana.paper, eve.cookie)).toEqual([]);
    expect((await shared(ana.paper, bob.cookie)).length).toBe(1);
    expect(await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation_share WHERE "annotationId" = $1`, [made.id])).toEqual([{ n: 1 }]);

    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });
    expect((await shared(ana.paper)).length).toBe(1);
    expect(await app.dataSource.query(`SELECT count(*)::int AS n FROM paper_annotation_share_recipient`)).toEqual([{ n: expect.any(Number) }]);
    expect((await mine(ana.cookie, ana.paper, made.id)).share.recipients).toEqual([]);
  });
});

describe('when the source changes', () => {
  it('keeps the copy as it was shared when the annotation is edited, until it is shared again', async () => {
    const ana = await reader('Ana Edit');
    const note = await make(ana.cookie, ana.paper, { kind: 'note', body: 'first draft' });
    await share(ana.cookie, ana.paper, note.id, { visibility: 'public' });
    const before = (await mine(ana.cookie, ana.paper, note.id)).share;

    expect((await send('PATCH', `${annotations(ana.paper)}/${note.id}`, ana.cookie, { body: 'second thoughts' })).status).toBe(200);
    expect((await shared(ana.paper))[0].body).toBe('first draft');
    expect((await mine(ana.cookie, ana.paper, note.id)).share.updatedAt).toBe(before.updatedAt);

    await share(ana.cookie, ana.paper, note.id, { visibility: 'public' });
    expect((await shared(ana.paper))[0].body).toBe('second thoughts');
    expect((await mine(ana.cookie, ana.paper, note.id)).share.sharedAt).toBe(before.sharedAt);
  });

  it('takes the copy away when the annotation is deleted', async () => {
    const ana = await reader('Ana Delete');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    expect((await send('DELETE', `${annotations(ana.paper)}/${made.id}`, ana.cookie)).status).toBe(204);
    expect(await shared(ana.paper)).toEqual([]);
  });

  it('keeps the copy when the PDF is replaced or removed: it never depended on the file', async () => {
    const ana = await reader('Ana Replace');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    expect((await upload(ana.cookie, ana.paper, makePdf({ padding: 2 }))).status).toBe(200);
    expect((await mine(ana.cookie, ana.paper, made.id)).stale).toBe(true);
    expect((await shared(ana.paper)).map((i) => i.quote)).toEqual(['the quorum is a majority']);

    expect((await send('DELETE', `/papers/${ana.paper}/attachment`, ana.cookie)).status).toBe(204);
    expect((await shared(ana.paper)).length).toBe(1);
  });

  it('keeps the copy when a stale annotation becomes a note', async () => {
    const ana = await reader('Ana Keep');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });
    await upload(ana.cookie, ana.paper, makePdf({ padding: 3 }));

    expect((await send('PATCH', `${annotations(ana.paper)}/${made.id}`, ana.cookie, { kind: 'note' })).status).toBe(200);
    expect((await shared(ana.paper)).map((i) => [i.kind, i.page])).toEqual([['highlight', 3]]);
  });

  it('takes the copies away when the paper leaves the library, and not before', async () => {
    const ana = await reader('Ana Leave');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });
    expect((await shared(ana.paper)).length).toBe(1);

    expect((await send('DELETE', `/paper-library/${ana.paper}`, ana.cookie)).status).toBe(204);
    expect(await shared(ana.paper)).toEqual([]);
  });

  it('takes the copies away with the reader, and only the recipient link when a recipient goes', async () => {
    const ana = await reader('Ana Account');
    const bob = await signIn('Bob Account');
    const a = await make(ana.cookie, ana.paper, highlight());
    const b = await make(ana.cookie, ana.paper, highlight({ quote: 'chosen' }));
    await share(ana.cookie, ana.paper, a.id, { visibility: 'public' });
    await share(ana.cookie, ana.paper, b.id, { visibility: 'users', recipients: [bob.slug] });

    await app.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [bob.id]);
    expect((await shared(ana.paper, ana.cookie)).length).toBe(2);
    expect((await mine(ana.cookie, ana.paper, b.id)).share.recipients).toEqual([]);

    await app.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [ana.id]);
    expect(await shared(ana.paper)).toEqual([]);
  });
});

describe('who the author is', () => {
  it('shows the name the author chose, and the link to a public profile', async () => {
    const ana = await reader('Ana Name');
    expect((await send('PUT', '/auth/settings', ana.cookie, { displayName: `Dr Ana ${run}` })).status).toBe(200);
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    expect((await shared(ana.paper))[0].author).toMatchObject({ name: `Dr Ana ${run}`, profile: ana.slug });
  });

  it('gives no link when the profile is not public, and the profile id when there is no vanity link', async () => {
    const ana = await reader('Ana Link');
    const made = await make(ana.cookie, ana.paper, highlight());
    await share(ana.cookie, ana.paper, made.id, { visibility: 'public' });

    expect((await send('PUT', '/auth/profile-slug', ana.cookie, { slug: null })).status).toBe(200);
    expect((await shared(ana.paper))[0].author.profile).toBe(ana.profile);
    expect((await send('PUT', '/auth/settings', ana.cookie, { profilePublic: false })).status).toBe(200);
    expect((await shared(ana.paper))[0].author).toMatchObject({ name: `Ana Link ${run}`, profile: null });
  });
});
