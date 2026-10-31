import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deflated, makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * Private PDF attachments (#183). Every test is a request to the real Nest app (its own port, real
 * database, real S3-compatible storage) and an assertion on the response; the few direct looks at the
 * database or at storage only confirm what the response already claims (the key is opaque, the bytes are
 * gone from storage after a deletion).
 */
const run = Math.random().toString(36).slice(2, 8);
const MAX = 200_000;
const QUOTA = 300_000;

let app: AttachmentsApp;
/** The public papers of this run are files (#213), so there are enough of them before the app boots. */
const PAPERS = Array.from({ length: 80 }, (_, i) => ({
  slug: `att-${run}-${i + 1}`,
  title: `Attachment paper ${i + 1} ${run}`,
}));

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

async function signIn(name: string): Promise<string> {
  const res = await fetch(`${app.url}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `${name} ${run}` }),
  });
  expect(res.status).toBe(201);
  return (res.headers.getSetCookie()[0] ?? '').split(';')[0];
}

let seq = 0;
/** The slug of a public paper no other test has used, so each test starts with nobody's PDF on it. */
function newPaper(_label: string): string {
  if (seq >= PAPERS.length) throw new Error('more papers needed than the fixtures have');
  return PAPERS[seq++].slug;
}

const upload = (
  cookie: string | undefined,
  paperId: string,
  body: Buffer | string | undefined,
  headers: Record<string, string> = {},
) =>
  fetch(`${app.url}/papers/${paperId}/attachment`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/pdf',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body as BodyInit | undefined,
  });

const call = (method: string, path: string, cookie?: string) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
  });

const view = (paperId: string, cookie: string) =>
  call('GET', `/papers/${paperId}/attachment`, cookie);
const file = (paperId: string, cookie: string) =>
  call('GET', `/papers/${paperId}/attachment/file`, cookie);

/** The object key a version row points to (null once its bytes are gone). */
async function keyOf(paperId: string, version: number): Promise<string | null> {
  const rows: { objectKey: string | null }[] = await app.dataSource.query(
    `SELECT v."objectKey" FROM paper_attachment_version v
       JOIN paper_attachment a ON a.id = v."attachmentId"
      WHERE a."paperSlug" = $1 AND v.version = $2`,
    [paperId, version],
  );
  return rows[0]?.objectKey ?? null;
}

/** Storage deletes in the background; wait for the object to be gone instead of sleeping. */
async function gone(key: string): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    await app.maintain();
    if ((await app.storage.head(key)) === null) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

beforeAll(async () => {
  app = await startAttachmentsApp({ maxBytes: MAX, quotaBytes: QUOTA }, PAPERS);
});

afterAll(async () => {
  await app.dataSource.query(`DELETE FROM paper_attachment WHERE "paperSlug" LIKE $1`, [
    `att-${run}-%`,
  ]);
  await app.maintain();
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [
    `% ${run}`,
  ]);
  await app.maintain();
  await app.close();
});

describe('who can reach an attachment', () => {
  it.each([
    ['upload', (id: string) => upload(undefined, id, makePdf())],
    [
      'read the record',
      (id: string) => call('GET', `/papers/${id}/attachment`),
    ],
    ['download', (id: string) => call('GET', `/papers/${id}/attachment/file`)],
    ['delete', (id: string) => call('DELETE', `/papers/${id}/attachment`)],
  ])('answers 401 to %s without a session', async (_name, send) => {
    const paper = await newPaper('anon');
    expect((await send(paper)).status).toBe(401);
  });

  it('answers 401 to a forged session cookie', async () => {
    const paper = await newPaper('forged');
    const res = await upload('uid=1.forged', paper, makePdf());
    expect(res.status).toBe(401);
  });

  it("keeps one reader's file out of reach of another: read, download and delete", async () => {
    const paper = await newPaper('priv');
    const ana = await signIn('ana');
    const bia = await signIn('bia');
    const content = makePdf({ padding: 50 });
    expect((await upload(ana, paper, content)).status).toBe(201);

    expect((await view(paper, bia)).status).toBe(404);
    expect((await file(paper, bia)).status).toBe(404);
    // Deleting "their" attachment is a no-op for the stranger and leaves the owner's file alone.
    expect(
      (await call('DELETE', `/papers/${paper}/attachment`, bia)).status,
    ).toBe(204);

    const kept = await file(paper, ana);
    expect(kept.status).toBe(200);
    expect(Buffer.from(await kept.arrayBuffer())).toEqual(content);
  });

  it('gives each reader their own attachment for the same paper', async () => {
    const paper = await newPaper('two');
    const ana = await signIn('two-a');
    const bia = await signIn('two-b');
    const first = makePdf({ padding: 10 });
    const second = makePdf({ padding: 20 });
    expect((await upload(ana, paper, first)).status).toBe(201);
    expect((await upload(bia, paper, second)).status).toBe(201);

    expect(Buffer.from(await (await file(paper, ana)).arrayBuffer())).toEqual(
      first,
    );
    expect(Buffer.from(await (await file(paper, bia)).arrayBuffer())).toEqual(
      second,
    );
  });

  it('never lists an attachment on the public paper record', async () => {
    const paper = await newPaper('public');
    const ana = await signIn('public');
    await upload(ana, paper, makePdf(), { 'X-Filename': 'secret-draft.pdf' });

    const res = await call('GET', `/papers/${paper}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('attachment');
    expect(text).not.toContain('secret-draft');
  });
});

describe('uploading a PDF', () => {
  it('stores it, approves it and describes it', async () => {
    const paper = await newPaper('ok');
    const ana = await signIn('ok');
    const content = makePdf({ padding: 100 });

    const res = await upload(ana, paper, content, {
      'X-Filename': 'My Paper.pdf',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      visibility: 'private',
      current: 1,
      versions: [
        {
          version: 1,
          state: 'approved',
          filename: 'My Paper.pdf',
          size: content.length,
          sha256: sha256(content),
          rejectReason: null,
        },
      ],
    });

    const again = await view(paper, ana);
    expect(again.status).toBe(200);
    expect((await again.json()).current).toBe(1);
  });

  it('serves exactly the bytes it was given, as a download that the browser cannot run', async () => {
    const paper = await newPaper('dl');
    const ana = await signIn('dl');
    const content = makePdf({ padding: 300 });
    await upload(ana, paper, content, {
      'X-Filename': encodeURIComponent('Tést ünïcode.pdf'),
    });

    const res = await file(paper, ana);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(content);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBe(String(content.length));
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''T%C3%A9st%20%C3%BCn%C3%AFcode.pdf",
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('etag')).toBe(`"${sha256(content)}"`);
  });

  it('keeps the bytes in storage under an opaque key, never one built from the file name', async () => {
    const paper = await newPaper('key');
    const ana = await signIn('key');
    const content = makePdf({ padding: 64 });
    await upload(ana, paper, content, {
      'X-Filename': '../../other-user/evil.pdf',
    });

    const key = await keyOf(paper, 1);
    expect(key).toMatch(/^papers\/[0-9a-f-]{36}$/);
    expect(key).not.toContain('evil');
    const stored = await app.storage.head(key!);
    expect(stored?.size).toBe(content.length);
    expect(stored?.contentType).toBe('application/pdf');

    // Only the last path segment survives as the display name.
    const record = await (await view(paper, ana)).json();
    expect(record.versions[0].filename).toBe('evil.pdf');
  });

  it('decides the type by the content: a real PDF sent as octet-stream is accepted', async () => {
    const paper = await newPaper('octet');
    const ana = await signIn('octet');
    const res = await upload(ana, paper, makePdf(), {
      'Content-Type': 'application/octet-stream',
    });
    expect(res.status).toBe(201);
    expect((await res.json()).versions[0].state).toBe('approved');
  });

  it('accepts a PDF with a benign /OpenAction and a name that only starts like a script name', async () => {
    const paper = await newPaper('benign');
    const ana = await signIn('benign');
    const content = makePdf({
      catalog: '/OpenAction [3 0 R /Fit] /JSON (not a script) /Launcher (x)',
    });
    expect((await upload(ana, paper, content)).status).toBe(201);
  });

  it('falls back to a plain name when none is given or it is only path characters', async () => {
    const paper = await newPaper('name');
    const ana = await signIn('name');
    await upload(ana, paper, makePdf(), { 'X-Filename': '..' });
    expect((await (await view(paper, ana)).json()).versions[0].filename).toBe(
      'paper.pdf',
    );
  });

  it('answers 404 for a paper that does not exist, or an id that is not one', async () => {
    const ana = await signIn('404');
    const unknown = '01a191ed-2e04-7235-ae86-8483c518560e';
    expect((await upload(ana, unknown, makePdf())).status).toBe(404);
    expect((await view(unknown, ana)).status).toBe(404);
    // The integer a paper used to have in its URL, a slug in capital letters, and a slug no paper has.
    for (const notAnId of ['2147483000', '99999999999', 'abc', PAPERS[0].slug.toUpperCase()]) {
      expect((await upload(ana, notAnId, makePdf())).status).toBe(404);
      expect((await view(notAnId, ana)).status).toBe(404);
    }
  });
});

describe('refusing what is not a clean PDF', () => {
  /** Uploads, expects the refusal, and checks nothing is served and nothing is left in storage. */
  async function refused(
    label: string,
    body: Buffer | string,
    code: string,
    headers: Record<string, string> = {},
  ) {
    const paper = await newPaper(label);
    const ana = await signIn(label);
    const res = await upload(ana, paper, body, headers);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code });

    // The record says it was refused and why; there is no file to serve.
    const record = await (await view(paper, ana)).json();
    expect(record.current).toBeNull();
    expect(record.versions).toHaveLength(1);
    expect(record.versions[0]).toMatchObject({ state: 'rejected' });
    expect(record.versions[0].rejectCode).toBe(code);
    expect(record.versions[0].rejectReason).toBeTruthy();
    expect((await file(paper, ana)).status).toBe(404);
    expect(await keyOf(paper, 1)).toBeNull();
  }

  const pdf = makePdf();
  const zip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(200, 1),
  ]);

  it.each([
    ['html', Buffer.from('<html><script>alert(1)</script></html>')],
    ['zip', zip],
    ['text', Buffer.from('just some text, not a document')],
    ['exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 7)])],
  ])('refuses %s bytes declared as application/pdf', async (label, body) => {
    await refused(`spoof-${label}`, body, 'not_pdf');
  });

  it('refuses a file that only contains a PDF header after other bytes (a polyglot)', async () => {
    await refused(
      'polyglot',
      Buffer.concat([Buffer.from('GIF89a'), pdf]),
      'not_pdf',
    );
  });

  it('refuses a header with a version no PDF has', async () => {
    await refused(
      'version',
      Buffer.from(
        pdf.toString('latin1').replace('%PDF-1.4', '%PDF-9.9'),
        'latin1',
      ),
      'not_pdf',
    );
  });

  it.each([
    ['header only', Buffer.from('%PDF-1.4\n')],
    ['cut short', pdf.subarray(0, pdf.length - 40)],
    ['no objects', Buffer.from('%PDF-1.4\nstartxref\n9\n%%EOF\n')],
    [
      'no ending',
      Buffer.from(`${pdf.toString('latin1').replace('%%EOF', '')}`, 'latin1'),
    ],
  ])('refuses a damaged PDF: %s', async (label, body) => {
    await refused(`bad-${label.replace(/ /g, '')}`, body, 'malformed');
  });

  it('refuses an encrypted PDF, whose streams cannot be inspected', async () => {
    await refused('enc', makePdf({ trailer: '/Encrypt 9 0 R' }), 'encrypted');
  });

  it.each([
    [
      'a script',
      { catalog: '/AA << /O << /S /JavaScript /JS (app.alert(1)) >> >>' },
    ],
    ['a short script key', { catalog: '/OpenAction << /S /JS /JS (x) >>' }],
    [
      'a launch action',
      { catalog: '/OpenAction << /S /Launch /F (cmd.exe) >>' },
    ],
    ['rich media', { objects: ['<< /Subtype /RichMedia >>'] }],
    [
      'a form that posts elsewhere',
      { objects: ['<< /S /SubmitForm /F (http://evil.test) >>'] },
    ],
  ])('refuses a PDF with %s', async (label, options) => {
    await refused(
      `act-${label.replace(/ /g, '')}`,
      makePdf(options),
      'active_content',
    );
  });

  it('refuses a script whose name is written with hex escapes', async () => {
    await refused(
      'hex',
      makePdf({ catalog: '/AA << /O << /S /J#61vaScr#69pt /JS (x) >> >>' }),
      'active_content',
    );
  });

  it('finds a script hidden inside a compressed object stream', async () => {
    const hidden = deflated('<< /S /JavaScript /JS (app.alert(1)) >>');
    await refused(
      'objstm',
      makePdf({ objectStream: hidden }),
      'active_content',
    );
  });

  it('accepts a compressed object stream that holds nothing active', async () => {
    const paper = await newPaper('objstm-ok');
    const ana = await signIn('objstm-ok');
    const res = await upload(
      ana,
      paper,
      makePdf({ objectStream: deflated('<< /Type /Annot /Subtype /Link >>') }),
    );
    expect(res.status).toBe(201);
  });

  it('refuses an object stream it cannot read, instead of trusting it', async () => {
    const unreadable = makePdf({
      objectStream: [
        '/Filter /ASCII85Decode',
        Buffer.from('87cURD]i,"Ebo80~>'),
      ],
    });
    await refused('unreadable', unreadable, 'unscannable');
    const broken = makePdf({
      objectStream: [
        '/Filter /FlateDecode',
        Buffer.from('this is not deflate data at all'),
      ],
    });
    await refused('broken', broken, 'unscannable');
  });

  it('refuses a decompression bomb: a small object stream that inflates past the limit', async () => {
    // 80 MB of zeros deflates to about 80 KB, under the upload limit.
    const bomb = makePdf({
      objectStream: [
        '/Filter /FlateDecode',
        deflateSync(Buffer.alloc(80 * 1024 * 1024)),
      ],
    });
    expect(bomb.length).toBeLessThan(MAX);
    await refused('bomb', bomb, 'unscannable');
  });

  it('answers 415 when the body is not sent as a PDF at all', async () => {
    const paper = await newPaper('type');
    const ana = await signIn('type');
    expect(
      (await upload(ana, paper, makePdf(), { 'Content-Type': 'text/plain' }))
        .status,
    ).toBe(415);
    expect(
      (
        await upload(ana, paper, '{"a":1}', {
          'Content-Type': 'application/json',
        })
      ).status,
    ).toBe(415);
    expect((await view(paper, ana)).status).toBe(404);
  });

  it('answers 400 for an empty body', async () => {
    const paper = await newPaper('empty');
    const ana = await signIn('empty');
    const res = await upload(ana, paper, Buffer.alloc(0));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'empty_body' });
  });
});

describe('limits', () => {
  it('answers 413 for a file over the size limit, without keeping anything', async () => {
    const paper = await newPaper('big');
    const ana = await signIn('big');
    const res = await upload(ana, paper, makePdf({ padding: MAX + 10 }));
    expect(res.status).toBe(413);
    expect((await view(paper, ana)).status).toBe(404);
  });

  it('accepts a file right at the limit', async () => {
    const paper = await newPaper('edge');
    const ana = await signIn('edge');
    // The cross-reference offsets grow with the padding, so settle on the padding that gives MAX bytes.
    let padding = MAX - makePdf().length;
    let exact = makePdf({ padding });
    for (let i = 0; i < 3 && exact.length !== MAX; i++) {
      padding -= exact.length - MAX;
      exact = makePdf({ padding });
    }
    expect(exact.length).toBe(MAX);
    expect((await upload(ana, paper, exact)).status).toBe(201);
  });

  it("refuses an upload that would pass the reader's storage quota, and frees it when a file is deleted", async () => {
    const ana = await signIn('quota');
    const first = await newPaper('quota-1');
    const second = await newPaper('quota-2');
    const third = await newPaper('quota-3');
    const body = makePdf({ padding: 130_000 }); // two fit in 300 KB, a third does not

    expect((await upload(ana, first, body)).status).toBe(201);
    expect((await upload(ana, second, body)).status).toBe(201);
    const over = await upload(ana, third, body);
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: 'quota_exceeded' });

    expect(
      (await call('DELETE', `/papers/${first}/attachment`, ana)).status,
    ).toBe(204);
    expect((await upload(ana, third, body)).status).toBe(201);
  });

  it('lets a reader replace a file that fills the quota, since the old one goes away', async () => {
    const ana = await signIn('quota-replace');
    const paper = await newPaper('quota-replace');
    const body = makePdf({ padding: 200_000 - 400 });
    expect((await upload(ana, paper, body)).status).toBe(201);
    expect((await upload(ana, paper, body)).status).toBe(200);
  });

  it('runs one upload at a time per reader', async () => {
    const ana = await signIn('parallel');
    const a = await newPaper('parallel-a');
    const b = await newPaper('parallel-b');
    const body = makePdf({ padding: 150_000 });

    const statuses = (
      await Promise.all([upload(ana, a, body), upload(ana, b, body)])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 429]);
  });
});

describe('replacing and deleting', () => {
  it('adds a version, serves the new one and removes the old bytes from storage', async () => {
    const paper = await newPaper('replace');
    const ana = await signIn('replace');
    const first = makePdf({ padding: 11 });
    const second = makePdf({ padding: 22 });
    await upload(ana, paper, first, { 'X-Filename': 'v1.pdf' });
    const oldKey = (await keyOf(paper, 1))!;

    const res = await upload(ana, paper, second, { 'X-Filename': 'v2.pdf' });
    expect(res.status).toBe(200);
    const record = await res.json();
    expect(record.current).toBe(2);
    expect(
      record.versions.map((v: { version: number; state: string }) => [
        v.version,
        v.state,
      ]),
    ).toEqual([
      [2, 'approved'],
      [1, 'superseded'],
    ]);

    expect(Buffer.from(await (await file(paper, ana)).arrayBuffer())).toEqual(
      second,
    );
    expect(await keyOf(paper, 1)).toBeNull();
    expect(await gone(oldKey)).toBe(true);
  });

  it('keeps serving the old file when the replacement is refused', async () => {
    const paper = await newPaper('keep');
    const ana = await signIn('keep');
    const good = makePdf({ padding: 33 });
    await upload(ana, paper, good);

    const res = await upload(
      ana,
      paper,
      makePdf({ catalog: '/OpenAction << /S /JavaScript /JS (x) >>' }),
    );
    expect(res.status).toBe(422);

    const record = await (await view(paper, ana)).json();
    expect(record.current).toBe(1);
    expect(record.versions.map((v: { state: string }) => v.state)).toEqual([
      'rejected',
      'approved',
    ]);
    expect(Buffer.from(await (await file(paper, ana)).arrayBuffer())).toEqual(
      good,
    );
  });

  it('keeps only the latest refusal, not a pile of them', async () => {
    const paper = await newPaper('refusals');
    const ana = await signIn('refusals');
    await upload(ana, paper, Buffer.from('not a pdf'));
    await upload(ana, paper, Buffer.from('still not a pdf'));
    const record = await (await view(paper, ana)).json();
    expect(record.versions).toHaveLength(1);
  });

  it('deletes the attachment and every object it had', async () => {
    const paper = await newPaper('delete');
    const ana = await signIn('delete');
    await upload(ana, paper, makePdf({ padding: 1 }));
    await upload(ana, paper, makePdf({ padding: 2 }));
    const live = (await keyOf(paper, 2))!;

    expect(
      (await call('DELETE', `/papers/${paper}/attachment`, ana)).status,
    ).toBe(204);
    expect((await view(paper, ana)).status).toBe(404);
    expect((await file(paper, ana)).status).toBe(404);
    expect(await gone(live)).toBe(true);
    // Deleting again is harmless.
    expect(
      (await call('DELETE', `/papers/${paper}/attachment`, ana)).status,
    ).toBe(204);
  });

  it('removes the objects when the private paper or the reader is deleted, whoever deletes them', async () => {
    const ana = await signIn('cascade');
    const made = await fetch(
      `${app.url}/paper-library/private?title=${encodeURIComponent(`Cascade ${run}`)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/pdf', Cookie: ana }, body: makePdf({ padding: 5 }) as BodyInit },
    );
    expect(made.status).toBe(201);
    const { paperId } = (await made.json()) as { paperId: string };
    const rows: { objectKey: string }[] = await app.dataSource.query(
      `SELECT v."objectKey" FROM paper_attachment_version v
         JOIN paper_attachment a ON a.id = v."attachmentId"
         JOIN paper p ON p.id = a."paperId"
        WHERE p."publicId" = $1`,
      [paperId],
    );
    expect(rows).toHaveLength(1);
    await app.dataSource.query(`DELETE FROM paper WHERE "publicId" = $1`, [paperId]);
    expect(await gone(rows[0].objectKey)).toBe(true);

    const bia = await signIn('cascade-user');
    const paperKept = await newPaper('cascade-user');
    await upload(bia, paperKept, makePdf({ padding: 6 }));
    const keyB = (await keyOf(paperKept, 1))!;
    await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" = $1`, [
      `cascade-user ${run}`,
    ]);
    expect(await gone(keyB)).toBe(true);
  });

  it('keeps a key in the deletion queue until storage confirms it is gone', async () => {
    const [{ count }] = await app.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM storage_deletion`,
    );
    expect(count).toBeGreaterThanOrEqual(0);
    await app.dataSource.query(
      `INSERT INTO storage_deletion ("objectKey") VALUES ($1)`,
      [`papers/never-existed-${run}`],
    );
    await app.maintain();
    // Deleting a key that is already gone counts as done, so it leaves the queue.
    const rows = await app.dataSource.query(
      `SELECT 1 FROM storage_deletion WHERE "objectKey" = $1`,
      [`papers/never-existed-${run}`],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('a file that is not approved is never served', () => {
  /** A version row written directly, as another process would leave it. */
  async function plant(
    paper: string,
    ana: string,
    state: string,
    withBytes: boolean,
  ) {
    const me: { id: number }[] = await app.dataSource.query(
      `SELECT id FROM "user" WHERE "displayName" = $1`,
      [`${ana} ${run}`],
    );
    const att: { id: number }[] = await app.dataSource.query(
      `INSERT INTO paper_attachment ("paperSlug", "ownerId") VALUES ($1, $2) RETURNING id`,
      [paper, me[0].id],
    );
    const key = withBytes ? `papers/planted-${run}-${paper}` : null;
    if (key) await app.storage.put(key, makePdf(), 'application/pdf');
    await app.dataSource.query(
      `INSERT INTO paper_attachment_version
         ("attachmentId", version, state, "objectKey", "originalName", size, sha256, "uploadedById")
       VALUES ($1, 1, $2, $3, 'planted.pdf', 10, $4, $5)`,
      [att[0].id, state, key, 'a'.repeat(64), me[0].id],
    );
    return key;
  }

  it.each([
    ['pending', true],
    ['rejected', false],
    ['superseded', false],
  ])(
    'answers 404 for a %s version, even though a row exists',
    async (state, withBytes) => {
      const paper = await newPaper(`planted-${state}`);
      const name = `planted-${state}`;
      const ana = await signIn(name);
      const key = await plant(paper, name, state, withBytes);

      const record = await (await view(paper, ana)).json();
      expect(record.current).toBeNull();
      expect(record.versions[0].state).toBe(state);
      expect((await file(paper, ana)).status).toBe(404);

      if (key) await app.storage.delete(key);
    },
  );

  it('retires a pending upload that never finished, and removes its bytes', async () => {
    const paper = await newPaper('stale');
    const name = 'stale';
    const ana = await signIn(name);
    const key = (await plant(paper, name, 'pending', true))!;
    await app.dataSource.query(
      `UPDATE paper_attachment_version SET "createdAt" = now() - interval '1 hour' WHERE "objectKey" = $1`,
      [key],
    );

    await app.maintain();
    const record = await (await view(paper, ana)).json();
    expect(record.versions[0].state).toBe('rejected');
    expect(record.versions[0].rejectCode).toBe('expired');
    expect(record.versions[0].rejectReason).toBeTruthy();
    expect(await gone(key)).toBe(true);
    expect((await file(paper, ana)).status).toBe(404);
  });

  it('answers 404 with a stable code when an approved file has vanished from storage', async () => {
    const paper = await newPaper('vanished');
    const ana = await signIn('vanished');
    await upload(ana, paper, makePdf({ padding: 7 }));
    await app.storage.delete((await keyOf(paper, 1))!);

    const res = await file(paper, ana);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'file_missing' });
  });
});

describe('the database refuses states that would expose or orphan a file', () => {
  it('does not allow a visibility other than private', async () => {
    const paper = await newPaper('visibility');
    const me = await app.dataSource.query(`SELECT id FROM "user" LIMIT 1`);
    await expect(
      app.dataSource.query(
        `INSERT INTO paper_attachment ("paperSlug", "ownerId", visibility) VALUES ($1, $2, 'public')`,
        [paper, me[0].id],
      ),
    ).rejects.toThrow();
  });

  it('does not allow a PDF that points at no paper, or at a public and a private one at once', async () => {
    const paper = newPaper('pointing');
    const ana = await signIn('pointing');
    const made = await fetch(`${app.url}/paper-library/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ana },
      body: JSON.stringify({ title: `Pointing ${run}`, authors: [{ name: 'Ada Lovelace' }], publicationDate: '2020' }),
    });
    expect(made.status).toBe(201);
    const { paperId } = (await made.json()) as { paperId: string };
    const [mine] = await app.dataSource.query(`SELECT id FROM paper WHERE "publicId" = $1`, [paperId]);
    const [me] = await app.dataSource.query(`SELECT id FROM "user" WHERE "displayName" = $1`, [`pointing ${run}`]);

    await expect(
      app.dataSource.query(`INSERT INTO paper_attachment ("ownerId") VALUES ($1)`, [me.id]),
    ).rejects.toThrow(/CHK_paper_attachment_one_paper/);
    await expect(
      app.dataSource.query(
        `INSERT INTO paper_attachment ("paperSlug", "paperId", "ownerId") VALUES ($1, $2, $3)`,
        [paper, mine.id, me.id],
      ),
    ).rejects.toThrow(/CHK_paper_attachment_one_paper/);
  });
});
