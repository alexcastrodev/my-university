import { RequestMethod } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaperAnnotationsModule } from '../src/paper-annotations/paper-annotations.module';
import { PaperAttachmentsModule } from '../src/paper-attachments/paper-attachments.module';
import { PaperAuditModule } from '../src/paper-audit/paper-audit.module';
import { PapersModule } from '../src/papers/papers.module';
import { PrivatePapersModule } from '../src/private-papers/private-papers.module';
import { makePdf } from './pdf-fixtures';
import { AttachmentsApp, startAttachmentsApp } from './papers-attachments-app';

/**
 * The security of the Papers area as a whole (#189): that no route answers without a session unless it is
 * public on purpose, that one reader cannot reach another's private paper, file, notes, shares or collections
 * through any route, and that what happens to a reader's files leaves a trail only they can read. Every test
 * is a request to the real Nest app and an assertion on the response.
 */
const run = Math.random().toString(36).slice(2, 8);
const PAPERS = [1, 2].map((n) => ({ slug: `sec-${run}-${n}`, title: `Security paper ${n} ${run}` }));

let app: AttachmentsApp;
let readers = 0;

const send = (method: string, path: string, cookie?: string, data?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: {
      ...(data === undefined || Buffer.isBuffer(data) ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : Buffer.isBuffer(data) ? (data as BodyInit) : JSON.stringify(data),
  });
const body = async (res: Response): Promise<any> => res.json();

async function signIn(name: string): Promise<string> {
  const res = await fetch(`${app.url}/auth/_test/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `${name}${readers++} ${run}` }),
  });
  expect(res.status).toBe(201);
  return (res.headers.getSetCookie()[0] ?? '').split(';')[0];
}

const idOf = async (cookie: string): Promise<number> => (await body(await send('GET', '/auth/me', cookie))).id;
const pdf = (cookie: string, paper: string, bytes: Buffer = makePdf({ padding: 1 })) =>
  send('PUT', `/papers/${paper}/attachment`, cookie, bytes, { 'Content-Type': 'application/pdf', 'X-Filename': 'secret-thesis.pdf' });
const activity = async (cookie: string): Promise<any[]> => {
  const res = await send('GET', '/paper-library/activity', cookie);
  expect(res.status).toBe(200);
  return (await body(res)).items;
};

beforeAll(async () => {
  app = await startAttachmentsApp({ maxBytes: 200_000, quotaBytes: 600_000 }, PAPERS);
});

afterAll(async () => {
  await app.dataSource.query(
    `DELETE FROM paper_audit_event WHERE "paperId" LIKE $1 OR "userId" IN (SELECT id FROM "user" WHERE "displayName" LIKE $2)`,
    [`sec-${run}-%`, `% ${run}`],
  );
  await app.dataSource.query(`DELETE FROM paper_attachment WHERE "paperSlug" LIKE $1`, [`sec-${run}-%`]);
  await app.maintain();
  await app.dataSource.query(`DELETE FROM paper WHERE title LIKE $1`, [`%${run}%`]);
  await app.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [`% ${run}`]);
  await app.close();
});

describe('every route needs a session unless it is public on purpose', () => {
  /** Every route of the Papers controllers, found from their decorators, so a new one cannot be forgotten. */
  function routes(): { method: string; path: string }[] {
    const modules = [PapersModule, PaperAttachmentsModule, PaperAnnotationsModule, PrivatePapersModule, PaperAuditModule];
    const out: { method: string; path: string }[] = [];
    for (const module of modules) {
      for (const controller of Reflect.getMetadata('controllers', module) as (new () => object)[]) {
        const base = Reflect.getMetadata('path', controller) as string;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = (controller.prototype as Record<string, unknown>)[name];
          const method = Reflect.getMetadata('method', handler as object) as RequestMethod | undefined;
          if (method === undefined) continue;
          const path = (Reflect.getMetadata('path', handler as object) as string).replace(/^\/+/, '');
          out.push({ method: RequestMethod[method], path: `/${[base, path].filter((p) => p !== '/' && p).join('/')}` });
        }
      }
    }
    return out;
  }

  /** What anyone may read without signing in: the catalog of public papers and what readers chose to share. */
  const PUBLIC = ['GET /papers', 'GET /papers/facets', 'GET /papers/:slug', 'GET /papers/:slug/shared-annotations'];

  it('finds the routes, and every public one is named here', () => {
    const found = routes();
    expect(found.length).toBeGreaterThan(30);
    const names = found.map((r) => `${r.method} ${r.path}`);
    for (const route of PUBLIC) expect(names, route).toContain(route);
  });

  it('answers 401 to a request without a session, on every route that is not public', async () => {
    const sample: Record<string, string> = { ':paperId': 'a-paper', ':slug': 'a-paper', ':id': '0198a0a0-0000-7000-8000-000000000000' };
    const open: string[] = [];
    for (const route of routes()) {
      if (PUBLIC.includes(`${route.method} ${route.path}`)) continue;
      const url = route.path.replace(/:\w+/g, (param) => sample[param] ?? 'x');
      const sendsBody = ['POST', 'PUT', 'PATCH'].includes(route.method);
      const res = await send(route.method, url, undefined, sendsBody ? {} : undefined);
      if (res.status !== 401) open.push(`${route.method} ${route.path} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });
});

describe('one reader cannot reach another reader\'s private paper by any route', () => {
  it('answers 404 to every route that names it, and leaves the paper, its PDF, notes and collection as they were', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');

    // Ana's paper (it has no public page), with a PDF, a note and a collection.
    const made = await send('POST', '/paper-library/manual', ana, { title: `Ana's private paper ${run}`, authors: [{ name: 'Ada' }], publicationDate: '2020' });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const paper = (await body(made)).paperId as string;
    const bytes = makePdf({ padding: 7 });
    expect((await pdf(ana, paper, bytes)).status).toBe(201);
    const note = await body(await send('POST', `/paper-library/${paper}/annotations`, ana, { kind: 'note', body: 'only for me' }));
    const mine = await body(await send('POST', '/paper-library/collections', ana, { name: `Mine ${run}` }));
    expect((await send('PUT', `/paper-library/collections/${mine.id}/papers/${paper}`, ana)).status).toBe(200);
    const bobs = await body(await send('POST', '/paper-library/collections', bob, { name: `Bob's ${run}` }));

    const attempts: [string, string, unknown?][] = [
      ['GET', `/paper-library/${paper}`],
      ['PATCH', `/paper-library/${paper}`, { status: 'read' }],
      ['GET', `/paper-library/${paper}/paper`],
      ['GET', `/papers/${paper}`],
      ['GET', `/papers/${paper}/attachment`],
      ['GET', `/papers/${paper}/attachment/file`],
      ['GET', `/paper-library/${paper}/annotations`],
      ['POST', `/paper-library/${paper}/annotations`, { kind: 'note', body: 'planted' }],
      ['PATCH', `/paper-library/${paper}/annotations/${note.id}`, { body: 'rewritten' }],
      ['DELETE', `/paper-library/${paper}/annotations/${note.id}`],
      ['PUT', `/paper-library/${paper}/annotations/${note.id}/share`, { visibility: 'public' }],
      ['DELETE', `/paper-library/${paper}/annotations/${note.id}/share`],
      ['PUT', `/paper-library/collections/${mine.id}/papers/${paper}`],
      ['PUT', `/paper-library/collections/${bobs.id}/papers/${paper}`],
      ['PATCH', `/paper-library/collections/${mine.id}`, { name: 'Taken' }],
      ['GET', `/paper-library?collection=${mine.id}`],
    ];
    for (const [method, path, data] of attempts) {
      const res = await send(method, path, bob, data);
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // Writing to Ana's PDF slot, or removing it, does nothing either.
    expect((await pdf(bob, paper)).status).toBe(404);
    expect((await send('DELETE', `/papers/${paper}/attachment`, bob)).status).toBe(404);
    expect((await send('DELETE', `/paper-library/${paper}`, bob)).status).toBe(404);

    // Nothing of Ana's moved.
    const entry = await body(await send('GET', `/paper-library/${paper}`, ana));
    expect(entry).toMatchObject({ private: true, status: 'to-read', collections: [{ id: mine.id }] });
    const record = await body(await send('GET', `/papers/${paper}/attachment`, ana));
    expect(record.versions).toHaveLength(1);
    const file = await send('GET', `/papers/${paper}/attachment/file`, ana);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
    const notes = await body(await send('GET', `/paper-library/${paper}/annotations`, ana));
    expect(notes.items).toMatchObject([{ id: note.id, body: 'only for me' }]);
    expect(await activity(bob)).toEqual([]);
  });

  it('shows another reader nothing of what a reader shares with chosen people, or keeps for themselves', async () => {
    const ana = await signIn('Ana');
    const eve = await signIn('Eve');
    const paper = PAPERS[0].slug;
    await send('POST', '/paper-library', ana, { paperId: paper });
    const note = await body(await send('POST', `/paper-library/${paper}/annotations`, ana, { kind: 'note', body: 'a draft nobody asked for' }));
    expect((await send('GET', `/papers/${paper}/shared-annotations`, eve)).status).toBe(200);
    expect(JSON.stringify(await body(await send('GET', `/papers/${paper}/shared-annotations`, eve)))).not.toContain('a draft');
    // A note that was never shared is not on the public page for anyone, signed in or not.
    expect((await body(await send('GET', `/papers/${paper}/shared-annotations`))).items).toEqual([]);
    expect(note.share ?? null).toBeNull();
  });
});

describe('the audit trail', () => {
  it('records upload, download, share, revoke and delete in order, with no name or text in it', async () => {
    const ana = await signIn('Ana');
    const paper = PAPERS[1].slug;
    expect((await send('POST', '/paper-library', ana, { paperId: paper })).status).toBe(201);

    expect((await pdf(ana, paper)).status).toBe(201);
    expect((await send('GET', `/papers/${paper}/attachment/file`, ana)).status).toBe(200);
    expect((await pdf(ana, paper, makePdf({ catalog: '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>' }))).status).toBe(422);
    const note = await body(await send('POST', `/paper-library/${paper}/annotations`, ana, { kind: 'note', body: 'my private opinion' }));
    expect((await send('PUT', `/paper-library/${paper}/annotations/${note.id}/share`, ana, { visibility: 'public' })).status).toBe(200);
    expect((await send('DELETE', `/paper-library/${paper}/annotations/${note.id}/share`, ana)).status).toBe(204);
    expect((await send('DELETE', `/papers/${paper}/attachment`, ana)).status).toBe(204);
    expect((await send('DELETE', `/paper-library/${paper}`, ana)).status).toBe(204);

    const items = await activity(ana);
    expect(items.map((i) => [i.action, i.paperId])).toEqual([
      ['library.remove', paper],
      ['attachment.delete', paper],
      ['share.revoke', paper],
      ['share.create', paper],
      ['attachment.upload', paper],
      ['attachment.download', paper],
      ['attachment.upload', paper],
    ]);
    expect(items[6].detail).toMatchObject({ outcome: 'approved' });
    expect(items[4].detail).toMatchObject({ outcome: 'rejected', code: 'active_content' });
    expect(items[3].detail).toMatchObject({ visibility: 'public', kind: 'note', recipients: 0 });
    expect(items[0].detail).toEqual({ private: false });

    // What a row holds: no file name, no text, no address.
    const everything = JSON.stringify(items);
    for (const secret of ['secret-thesis', 'my private opinion', '127.0.0.1', 'app.alert']) expect(everything).not.toContain(secret);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(['action', 'createdAt', 'detail', 'id', 'paperId']);
  });

  it('records nothing for a request that changed nothing or was refused', async () => {
    const ana = await signIn('Ana');
    const paper = PAPERS[0].slug;
    await send('POST', '/paper-library', ana, { paperId: paper });
    await send('DELETE', `/papers/${paper}/attachment`, ana);
    expect((await send('GET', `/papers/${paper}/attachment/file`, ana)).status).toBe(404);
    expect((await send('GET', `/papers/${paper}/attachment/file`, await signIn('Bob'))).status).toBe(404);
    const note = await body(await send('POST', `/paper-library/${paper}/annotations`, ana, { kind: 'note', body: 'x' }));
    await send('DELETE', `/paper-library/${paper}/annotations/${note.id}/share`, ana);
    await send('DELETE', '/paper-library/no-such-paper', ana);
    expect(await activity(ana)).toEqual([]);
  });

  it('is read by its own reader only, and needs a session', async () => {
    const ana = await signIn('Ana');
    const bob = await signIn('Bob');
    const paper = PAPERS[0].slug;
    await send('POST', '/paper-library', ana, { paperId: paper });
    await send('DELETE', `/paper-library/${paper}`, ana);
    expect(await activity(ana)).toHaveLength(1);
    expect(await activity(bob)).toEqual([]);
    expect((await send('GET', '/paper-library/activity')).status).toBe(401);
  });

  it('keeps no more than the last 100 events in a reading, newest first', async () => {
    const ana = await signIn('Ana');
    const id = await idOf(ana);
    await app.dataSource.query(
      `INSERT INTO paper_audit_event ("userId", "action", "paperId", "createdAt")
       SELECT $1, 'attachment.download', 'p-' || n, now() - make_interval(secs => n) FROM generate_series(1, 120) AS n`,
      [id],
    );
    const items = await activity(ana);
    expect(items).toHaveLength(100);
    expect(items[0].paperId).toBe('p-1');
    expect(items[99].paperId).toBe('p-100');
  });

  it('purges what is older than the retention period, and keeps the rest', async () => {
    const ana = await signIn('Ana');
    const id = await idOf(ana);
    await app.dataSource.query(
      `INSERT INTO paper_audit_event ("userId", "action", "paperId", "createdAt") VALUES
         ($1, 'attachment.upload', 'old-one', now() - interval '200 days'),
         ($1, 'attachment.upload', 'recent-one', now() - interval '10 days')`,
      [id],
    );
    expect((await activity(ana)).map((i) => i.paperId)).toEqual(['recent-one', 'old-one']);
    expect(await app.audit.purge()).toBeGreaterThanOrEqual(1);
    expect((await activity(ana)).map((i) => i.paperId)).toEqual(['recent-one']);
  });

  it('outlives the reader\'s account without pointing at anyone', async () => {
    const ana = await signIn('Ana');
    const id = await idOf(ana);
    const paper = PAPERS[0].slug;
    await send('POST', '/paper-library', ana, { paperId: paper });
    await send('DELETE', `/paper-library/${paper}`, ana);
    await app.dataSource.query(`DELETE FROM "user" WHERE id = $1`, [id]);
    const left: { userId: number | null }[] = await app.dataSource.query(
      `SELECT "userId" FROM paper_audit_event WHERE action = 'library.remove' AND "paperId" = $1 AND "userId" IS NULL`,
      [paper],
    );
    expect(left.length).toBeGreaterThanOrEqual(1);
  });
});
