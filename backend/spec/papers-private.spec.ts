import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * Papers a reader adds by dropping a PDF (#203). Every test is a request to the real Nest app (own port, real
 * database, real S3-compatible storage) and an assertion on the response; the few looks at the database only
 * confirm what a response already claims (no second record, the row is gone).
 */
const run = Math.random().toString(36).slice(2, 8);
const MAX = 200_000;
const QUOTA = 300_000;
const CAP = 3;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let app: AttachmentsApp;
const catalogIds: number[] = [];
let seq = 0;

async function signIn(name: string): Promise<string> {
  const res = await fetch(`${app.url}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `${name} ${run}` }),
  });
  expect(res.status).toBe(201);
  return (res.headers.getSetCookie()[0] ?? '').split(';')[0];
}

/** A paper in the public catalog, with a DOI of its own. */
async function catalogPaper(
  label: string,
): Promise<{ publicId: string; doi: string }> {
  const n = ++seq;
  const doi = `10.5556/priv${run}.${n}`;
  const rows: { id: number; publicId: string }[] = await app.dataSource.query(
    `INSERT INTO paper (title, doi, fingerprint) VALUES ($1, $2, $3) RETURNING id, "publicId"`,
    [`Catalog paper ${label} ${run}`, doi, `fp-priv-${run}-${n}`],
  );
  catalogIds.push(rows[0].id);
  return { publicId: rows[0].publicId, doi };
}

interface Dropped {
  paperId: string;
  private: boolean;
  matched: boolean;
  created: boolean;
  library: { paperId: string; private: boolean; status: string };
  attachment: { current: number | null; versions: { filename: string }[] };
}

const drop = (
  cookie: string | undefined,
  params: Record<string, string>,
  body: Buffer | string = makePdf(),
  headers: Record<string, string> = {},
) =>
  fetch(`${app.url}/paper-library/private?${new URLSearchParams(params)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-Filename': 'My paper.pdf',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body as BodyInit,
  });

const get = (path: string, cookie?: string) =>
  fetch(`${app.url}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const del = (path: string, cookie: string) =>
  fetch(`${app.url}${path}`, { method: 'DELETE', headers: { Cookie: cookie } });

/** Drops a PDF and returns the response body, asserting it was accepted. */
async function dropOk(
  cookie: string,
  params: Record<string, string>,
): Promise<Dropped> {
  const res = await drop(cookie, params);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Dropped;
}

const privateCountOf = async (name: string): Promise<number> => {
  const rows: { n: string }[] = await app.dataSource.query(
    `SELECT COUNT(*) AS n FROM paper p JOIN "user" u ON u.id = p."ownerId" WHERE u."displayName" = $1`,
    [`${name} ${run}`],
  );
  return Number(rows[0].n);
};

beforeAll(async () => {
  app = await startAttachmentsApp({
    maxBytes: MAX,
    quotaBytes: QUOTA,
    privatePapers: CAP,
  });
});

afterAll(async () => {
  if (catalogIds.length) {
    await app.dataSource.query(`DELETE FROM paper WHERE id = ANY($1)`, [
      catalogIds,
    ]);
  }
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [
    `% ${run}`,
  ]);
  await app.maintain();
  await app.close();
});

describe('dropping a PDF that is not in the catalog', () => {
  it('creates a private paper in the reader library with the PDF attached', async () => {
    const ana = await signIn('creator');

    const res = await drop(ana, { title: `  My   own\tpaper ${run} ` });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Dropped;

    expect(body).toMatchObject({
      private: true,
      matched: false,
      created: true,
      library: { private: true, status: 'to-read' },
      attachment: { current: 1, versions: [{ filename: 'My paper.pdf' }] },
    });
    expect(body.paperId).toMatch(UUID_V7);
    expect(body.library.paperId).toBe(body.paperId);

    const paper = await get(`/paper-library/${body.paperId}/paper`, ana);
    expect(paper.status).toBe(200);
    const view = (await paper.json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      id: body.paperId,
      title: `My own paper ${run}`,
      doi: null,
    });
    // Neither the owner nor the integer key is part of the paper's view.
    expect(view).not.toHaveProperty('ownerId');
    expect(typeof view.id).toBe('string');

    const file = await get(`/papers/${body.paperId}/attachment/file`, ana);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
  });

  it('keeps the DOI the reader gave, normalized, when the catalog does not have it', async () => {
    const ana = await signIn('doi-keeper');
    const doi = `10.5557/free${run}`;

    const body = await dropOk(ana, {
      title: `With DOI ${run}`,
      doi: `https://doi.org/${doi.toUpperCase()}`,
    });

    expect(body).toMatchObject({ private: true, matched: false });
    const paper = await get(`/paper-library/${body.paperId}/paper`, ana);
    expect(await paper.json()).toMatchObject({ doi });
  });
});

describe('nobody else sees a private paper', () => {
  it('is a 404 by id for another reader, a visitor and the public routes, whatever the verb', async () => {
    const ana = await signIn('owner');
    const bob = await signIn('stranger');
    const { paperId } = await dropOk(ana, { title: `Hidden ${run}` });

    const everyone: [string, string | undefined][] = [
      ['visitor', undefined],
      ['another reader', bob],
    ];
    for (const [who, cookie] of everyone) {
      for (const path of [
        `/papers/${paperId}`,
        `/papers/${paperId}/analysis`,
        `/papers/${paperId}/attachment`,
        `/papers/${paperId}/attachment/file`,
        `/paper-library/${paperId}`,
        `/paper-library/${paperId}/paper`,
      ]) {
        const res = await get(path, cookie);
        // A visitor is stopped at the session for the reader-only routes: either way nothing is disclosed.
        expect([401, 404], `${who} GET ${path}`).toContain(res.status);
        expect(await res.text(), `${who} GET ${path}`).not.toContain(
          `Hidden ${run}`,
        );
      }
    }
    const asBob = await get(`/papers/${paperId}`, bob);
    expect(asBob.status).toBe(404);
    const asAnaPublic = await get(`/papers/${paperId}`, ana);
    expect(asAnaPublic.status).toBe(404);

    const add = await fetch(`${app.url}/paper-library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bob },
      body: JSON.stringify({ paperId }),
    });
    expect(add.status).toBe(404);
    const put = await fetch(`${app.url}/papers/${paperId}/attachment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', Cookie: bob },
      body: makePdf() as BodyInit,
    });
    expect(put.status).toBe(404);
  });

  it('is not in the catalog list, its search, its filters or its facets', async () => {
    const ana = await signIn('list-owner');
    const before = (await (await get('/papers/facets')).json()) as {
      types: { value: string; count: number }[];
    };
    const { paperId } = await dropOk(ana, {
      title: `Findable only by me ${run}`,
      doi: `10.5558/list${run}`,
    });

    for (const query of [
      `q=${encodeURIComponent(`Findable only by me ${run}`)}`,
      `doi=10.5558/list${run}`,
      `q=${run}`,
    ]) {
      const list = (await (await get(`/papers?${query}`)).json()) as {
        total: number;
        items: { id: string }[];
      };
      expect(list.total, query).toBe(0);
      expect(list.items.map((p) => p.id)).not.toContain(paperId);
    }
    const after = (await (await get('/papers/facets')).json()) as typeof before;
    expect(after.types).toEqual(before.types);

    // The owner finds it in the library, by search too, and it says it is private.
    const mine = (await (
      await get(
        `/paper-library?q=${encodeURIComponent(`Findable only by me ${run}`)}`,
        ana,
      )
    ).json()) as { total: number; items: { id: string; library: { private: boolean } }[] };
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({
      id: paperId,
      library: { private: true },
    });
  });

  it('is not reachable through the integer key it has inside', async () => {
    const ana = await signIn('legacy-owner');
    const { paperId } = await dropOk(ana, { title: `No old link ${run}` });
    const rows: { id: number }[] = await app.dataSource.query(
      `SELECT id FROM paper WHERE "publicId" = $1`,
      [paperId],
    );

    const res = await fetch(`${app.url}/papers/${rows[0].id}`, {
      redirect: 'manual',
    });

    expect(res.status).toBe(404);
  });

  it("does not let one reader's DOI find another reader's private paper", async () => {
    const ana = await signIn('doi-a');
    const bob = await signIn('doi-b');
    const doi = `10.5559/shared${run}`;

    const first = await dropOk(ana, { title: `Ana copy ${run}`, doi });
    const second = await dropOk(bob, { title: `Bob copy ${run}`, doi });

    expect(second).toMatchObject({ private: true, matched: false });
    expect(second.paperId).not.toBe(first.paperId);
    const asBob = await get(`/paper-library/${first.paperId}/paper`, bob);
    expect(asBob.status).toBe(404);
  });

  it('is never merged into by an import of the same DOI, which makes its own public paper', async () => {
    const ana = await signIn('import-owner');
    const bob = await signIn('importer');
    const doi = `10.5560/imp${run}`;
    const mine = await dropOk(ana, { title: `Imported later ${run}`, doi });

    const created = await fetch(`${app.url}/papers/_test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: bob },
      body: JSON.stringify({
        title: `Imported later ${run}`,
        doi,
        authors: [{ name: 'Ada Lovelace' }],
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      paper: { id: string };
      created: boolean;
    };
    catalogIds.push(
      (
        (await app.dataSource.query(
          `SELECT id FROM paper WHERE "publicId" = $1`,
          [body.paper.id],
        )) as { id: number }[]
      )[0].id,
    );

    expect(body.created).toBe(true);
    expect(body.paper.id).not.toBe(mine.paperId);
    // And now a drop with that DOI matches the public paper, not a private one.
    const again = await dropOk(await signIn('import-after'), {
      title: `Again ${run}`,
      doi,
    });
    expect(again).toMatchObject({ matched: true, private: false });
    expect(again.paperId).toBe(body.paper.id);
  });
});

describe('a DOI that is already in the catalog', () => {
  it('adds the catalog paper with the PDF, and does not create a second record', async () => {
    const ana = await signIn('matcher');
    const catalog = await catalogPaper('match');

    const res = await drop(ana, {
      title: 'Whatever the file was called',
      doi: ` DOI:${catalog.doi.toUpperCase()} `,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Dropped;

    expect(body).toMatchObject({
      paperId: catalog.publicId,
      private: false,
      matched: true,
      created: true,
      library: { paperId: catalog.publicId, private: false },
      attachment: { current: 1 },
    });
    const papers: { n: string }[] = await app.dataSource.query(
      `SELECT COUNT(*) AS n FROM paper WHERE doi = $1 OR title = $2`,
      [catalog.doi, 'Whatever the file was called'],
    );
    expect(Number(papers[0].n)).toBe(1);
    expect(await privateCountOf('matcher')).toBe(0);

    // It stays a public paper: anyone can still read it, and the PDF is the reader's own.
    const asVisitor = await get(`/papers/${catalog.publicId}`);
    expect(asVisitor.status).toBe(200);
    const mine = await get(`/papers/${catalog.publicId}/attachment`, ana);
    expect(mine.status).toBe(200);
    const bob = await signIn('matcher-other');
    const theirs = await get(`/papers/${catalog.publicId}/attachment`, bob);
    expect(theirs.status).toBe(404);
  });

  it('adds a version when the paper was already in the library, and answers 200', async () => {
    const ana = await signIn('matcher-twice');
    const catalog = await catalogPaper('twice');
    await dropOk(ana, { title: 'One', doi: catalog.doi });

    const res = await drop(ana, { title: 'Two', doi: catalog.doi });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Dropped;
    expect(body).toMatchObject({ matched: true, created: false });
    expect(body.attachment.current).toBe(2);
    expect(body.attachment.versions).toHaveLength(2);
  });

  it('leaves the catalog paper in place when the reader takes it out of the library', async () => {
    const ana = await signIn('matcher-remove');
    const catalog = await catalogPaper('remove');
    await dropOk(ana, { title: 'Keep', doi: catalog.doi });

    const removed = await del(`/paper-library/${catalog.publicId}`, ana);

    expect(removed.status).toBe(204);
    const still = await get(`/papers/${catalog.publicId}`);
    expect(still.status).toBe(200);
  });
});

describe('deleting a private paper', () => {
  it('removes the paper, the library entry and the PDF from storage', async () => {
    const ana = await signIn('deleter');
    const { paperId } = await dropOk(ana, { title: `To delete ${run}` });
    const keys: { objectKey: string }[] = await app.dataSource.query(
      `SELECT v."objectKey" FROM paper_attachment_version v
         JOIN paper_attachment a ON a.id = v."attachmentId"
         JOIN paper p ON p.id = a."paperId"
        WHERE p."publicId" = $1`,
      [paperId],
    );
    expect(keys).toHaveLength(1);
    expect(await app.storage.head(keys[0].objectKey)).not.toBeNull();

    const removed = await del(`/paper-library/${paperId}`, ana);
    expect(removed.status).toBe(204);

    for (const path of [
      `/paper-library/${paperId}`,
      `/paper-library/${paperId}/paper`,
      `/papers/${paperId}/attachment`,
    ]) {
      expect((await get(path, ana)).status, path).toBe(404);
    }
    const list = (await (await get('/paper-library', ana)).json()) as {
      total: number;
    };
    expect(list.total).toBe(0);
    const rows: { n: string }[] = await app.dataSource.query(
      `SELECT COUNT(*) AS n FROM paper WHERE "publicId" = $1`,
      [paperId],
    );
    expect(Number(rows[0].n)).toBe(0);
    let gone = false;
    for (let i = 0; i < 50 && !gone; i++) {
      await app.maintain();
      gone = (await app.storage.head(keys[0].objectKey)) === null;
      if (!gone) await new Promise((r) => setTimeout(r, 100));
    }
    expect(gone).toBe(true);
  });

  it("cannot be deleted by another reader, and the owner's copy stays", async () => {
    const ana = await signIn('del-owner');
    const bob = await signIn('del-stranger');
    const { paperId } = await dropOk(ana, { title: `Not yours ${run}` });

    const res = await del(`/paper-library/${paperId}`, bob);

    expect(res.status).toBe(404);
    expect((await get(`/paper-library/${paperId}/paper`, ana)).status).toBe(
      200,
    );
  });
});

describe('what a drop is refused for', () => {
  it('needs a session', async () => {
    const res = await drop(undefined, { title: `No session ${run}` });
    expect(res.status).toBe(401);
  });

  it.each([
    ['a missing title', {}, 400],
    ['a blank title', { title: '   ' }, 400],
    ['a title with a control character', { title: 'bad\u0007title' }, 400],
    ['a title longer than 300 characters', { title: 'x'.repeat(301) }, 400],
    ['a DOI that is not one', { title: 'Fine', doi: 'not a doi' }, 400],
    ['a field the route does not know', { title: 'Fine', extra: '1' }, 400],
  ])('answers 400 for %s and keeps nothing', async (_name, params, status) => {
    const ana = await signIn('refused');
    const before = await privateCountOf('refused');

    const res = await drop(ana, params as Record<string, string>);

    expect(res.status).toBe(status);
    expect(await privateCountOf('refused')).toBe(before);
  });

  it('names the problem in a code the client can branch on', async () => {
    const ana = await signIn('codes');

    const title = await drop(ana, { title: '  ' });
    const doi = await drop(ana, { title: 'Fine', doi: 'nope' });

    expect(await title.json()).toMatchObject({ code: 'invalid_title' });
    expect(await doi.json()).toMatchObject({ code: 'invalid_doi' });
  });

  it('refuses a file that is not a clean PDF and leaves no paper behind', async () => {
    const ana = await signIn('not-pdf');

    const res = await drop(
      ana,
      { title: `Not a pdf ${run}` },
      Buffer.from('this is plain text, not a PDF'),
    );

    expect(res.status).toBe(422);
    expect(await privateCountOf('not-pdf')).toBe(0);
    const list = (await (await get('/paper-library', ana)).json()) as {
      total: number;
    };
    expect(list.total).toBe(0);
  });

  it('refuses a PDF with active content and leaves no paper behind', async () => {
    const ana = await signIn('active-pdf');

    const res = await drop(
      ana,
      { title: `Active ${run}` },
      makePdf({ catalog: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>' }),
    );

    expect(res.status).toBe(422);
    expect(await privateCountOf('active-pdf')).toBe(0);
  });

  it('refuses a file over the size limit without creating anything', async () => {
    const ana = await signIn('too-big');

    const res = await drop(
      ana,
      { title: `Big ${run}` },
      makePdf({ padding: MAX + 1 }),
    );

    expect(res.status).toBe(413);
    expect(await privateCountOf('too-big')).toBe(0);
  });

  it('refuses a body that is not sent as a PDF', async () => {
    const ana = await signIn('wrong-type');

    const res = await drop(ana, { title: `Typed ${run}` }, 'plain', {
      'Content-Type': 'text/plain',
    });

    expect(res.status).toBe(415);
    expect(await privateCountOf('wrong-type')).toBe(0);
  });

  it('refuses a drop that would pass the reader storage quota, and keeps the earlier papers', async () => {
    const ana = await signIn('quota');
    await dropOk(ana, { title: `Fills ${run}` });
    const big = makePdf({ padding: 150_000 });
    expect(
      (await drop(ana, { title: `Second ${run}` }, big)).status,
    ).toBe(201);

    const over = await drop(ana, { title: `Third ${run}` }, big);

    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: 'quota_exceeded' });
    expect(await privateCountOf('quota')).toBe(2);
  });

  it(`stops at ${CAP} private papers per reader, and takes one more after a delete`, async () => {
    const ana = await signIn('capped');
    const other = await signIn('capped-other');
    const made: string[] = [];
    for (let i = 0; i < CAP; i++) {
      made.push((await dropOk(ana, { title: `Capped ${i} ${run}` })).paperId);
    }

    const over = await drop(ana, { title: `Capped over ${run}` });
    expect(over.status).toBe(409);
    expect(await over.json()).toMatchObject({ code: 'private_papers_limit' });
    // The cap is per reader: someone else is not affected.
    await dropOk(other, { title: `Not capped ${run}` });
    // A catalog match is not a private paper, so it still goes through at the cap.
    const catalog = await catalogPaper('cap');
    const matched = await drop(ana, { title: 'Catalog one', doi: catalog.doi });
    expect(matched.status).toBe(201);

    expect((await del(`/paper-library/${made[0]}`, ana)).status).toBe(204);
    const next = await drop(ana, { title: `Capped again ${run}` });
    expect(next.status).toBe(201);
  });
});
