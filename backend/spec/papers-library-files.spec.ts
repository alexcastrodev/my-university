import { afterAll, describe, expect, it } from 'vitest';
import { FixturePaper } from './papers-fixtures';
import { ImportApp, startImportApp } from './papers-import-app';

/**
 * A public paper is a file, so a deploy can remove it. These specs boot the real app three times on the same
 * database with different files, which is what a deploy that removes a paper and one that brings it back do,
 * and assert on what a reader sees through the library in each.
 */
const run = Math.random().toString(36).slice(2, 8);
const A: FixturePaper = { slug: `kept-${run}`, title: `Kept ${run}` };
const B: FixturePaper = { slug: `removed-${run}`, title: `Removed ${run}` };

let last: ImportApp | undefined;
const cleanup = async () => {
  await last?.dataSource.query(`DELETE FROM "user" WHERE "displayName" LIKE $1`, [`% ${run}`]);
};
afterAll(async () => {
  await cleanup();
  await last?.close();
});

/** Boots the app on these papers, closing the previous boot first. */
async function boot(papers: FixturePaper[]): Promise<ImportApp> {
  if (last) await last.close();
  last = await startImportApp(papers);
  return last;
}

const send = (app: ImportApp, method: string, path: string, cookie: string, data?: unknown) =>
  fetch(`${app.url}${path}`, {
    method,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), Cookie: cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

describe('a paper that leaves the files and comes back', () => {
  it('is hidden from the library while it is gone, and its entry is back when it returns', async () => {
    const first = await boot([A, B]);
    const login = await fetch(`${first.url}/auth/_test/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: `files ${run}` }),
    });
    expect(login.status).toBe(201);
    const cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0];
    expect((await send(first, 'POST', '/paper-library', cookie, { paperId: A.slug })).status).toBe(201);
    expect((await send(first, 'POST', '/paper-library', cookie, { paperId: B.slug, status: 'reading' })).status).toBe(
      201,
    );
    expect(((await (await send(first, 'GET', '/paper-library', cookie)).json()) as any).total).toBe(2);

    // A deploy removes B from the files.
    const second = await boot([A]);
    const gone = (await (await send(second, 'GET', '/paper-library', cookie)).json()) as any;
    expect(gone.total).toBe(1);
    expect(gone.items.map((i: any) => i.id)).toEqual([A.slug]);
    expect(await (await send(second, 'GET', '/paper-library/facets', cookie)).json()).toMatchObject({ total: 1 });
    expect((await send(second, 'GET', `/paper-library/${B.slug}`, cookie)).status).toBe(404);
    expect((await send(second, 'GET', `/paper-library/${B.slug}/paper`, cookie)).status).toBe(404);
    expect((await send(second, 'GET', `/papers/${B.slug}`, cookie)).status).toBe(404);
    expect((await send(second, 'POST', '/paper-library', cookie, { paperId: B.slug })).status).toBe(404);

    // A later deploy puts it back: the entry, with its status, is still there.
    const third = await boot([A, B]);
    const back = (await (await send(third, 'GET', '/paper-library', cookie)).json()) as any;
    expect(back.total).toBe(2);
    expect(back.items.find((i: any) => i.id === B.slug).library).toMatchObject({ status: 'reading', private: false });
  });
});
