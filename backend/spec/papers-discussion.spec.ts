import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { del, get, json, login, post } from './helpers';

/**
 * Live stack, like discussions.spec: a paper's discussion is the one concept pages use (same endpoints,
 * same authorization, same notifications), keyed `papers/<id>`. Papers are seeded through the dev-only route.
 */
const run = Math.random().toString(36).slice(2, 8);
let paperId: number;

const topic = (slug: string | number = paperId) => ({
  module: 'papers',
  slug: String(slug),
  lang: 'en',
});

const general = async (slug?: string | number, cookie?: string) =>
  get(
    `/discussions/general?module=papers&slug=${slug ?? paperId}&lang=en`,
    cookie ? { Cookie: cookie } : {},
  );

const startPost = (cookie: string, body = 'What does figure 2 show?') =>
  post(
    '/discussions/general',
    { ...topic(), body },
    { Cookie: cookie },
  );

beforeAll(async () => {
  const res = await post('/papers/_test', {
    title: `Discussion paper ${run}`,
    authors: [{ name: 'Ada Lovelace' }],
  });
  expect(res.status).toBe(201);
  paperId = (await json<{ paper: { id: number } }>(res)).paper.id;
});
afterAll(async () => {
  await del(`/papers/_test/${paperId}`);
});

describe('discussion on a paper page', () => {
  it('starts empty and public: anyone can read it without a session', async () => {
    const res = await general();
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ commentCount: 0, threads: [] });
  });

  it('lets a signed-in reader post, and shows the post to everyone', async () => {
    const ana = await login(`paper-ana-${run}`);

    const created = await startPost(ana.cookie);
    expect(created.status).toBe(201);

    const seen = await json<any>(await general());
    expect(seen.commentCount).toBeGreaterThanOrEqual(1);
    expect(seen.threads.map((t: any) => t.root.body)).toContain(
      'What does figure 2 show?',
    );
  });

  it('refuses a post without a session', async () => {
    const res = await post('/discussions/general', {
      ...topic(),
      body: 'anonymous',
    });
    expect(res.status).toBe(401);
  });

  it('keeps one board per paper however the id is spelled', async () => {
    const ana = await login(`paper-pad-${run}`);
    const created = await json<{ markerId: number }>(
      await post(
        '/discussions/general',
        { ...topic(`00${paperId}`), body: 'padded id' },
        { Cookie: ana.cookie },
      ),
    );
    const plain = await json<any>(await general());
    expect(plain.id).toBe(created.markerId);
  });

  it('answers 404 for a paper that does not exist, on read and on write', async () => {
    const ana = await login(`paper-404-${run}`);
    expect((await general(2147483000)).status).toBe(404);
    const res = await post(
      '/discussions/general',
      { ...topic(2147483000), body: 'nobody home' },
      { Cookie: ana.cookie },
    );
    expect(res.status).toBe(404);
  });

  it.each([
    ['a slug that is not an id', 'not-an-id'],
    ['an id beyond the integer range', '99999999999'],
  ])('answers 404 for %s', async (_name, slug) => {
    expect((await general(slug)).status).toBe(404);
  });

  it('has no paragraph threads: a paper has no sections to quote', async () => {
    const ana = await login(`paper-thread-${run}`);
    const res = await post(
      '/discussions/threads',
      {
        ...topic(),
        anchorKey: 'abcdef0123456789',
        blockIndex: 1,
        quote: 'Discussion paper',
        body: 'a paragraph question',
      },
      { Cookie: ana.cookie },
    );
    expect(res.status).toBe(404);
  });

  it('does not take a discipline, which only curriculum concepts have', async () => {
    const res = await get(
      `/discussions/general?module=papers&slug=${paperId}&discipline=anything&lang=en`,
    );
    expect(res.status).toBe(404);
  });

  it('notifies the author of a post that got a reply, linking to the paper page', async () => {
    const ana = await login(`paper-n-a-${run}`);
    const bia = await login(`paper-n-b-${run}`);
    const { markerId, commentId } = await json<{
      markerId: number;
      commentId: number;
    }>(await startPost(ana.cookie, 'A question for the notification'));

    const answer = await post(
      `/discussions/markers/${markerId}/comments`,
      { parentId: commentId, body: 'An answer' },
      { Cookie: bia.cookie },
    );
    expect(answer.status).toBe(201);

    const inbox = await json<{ unread: number; items: any[] }>(
      await get('/discussions/notifications', { Cookie: ana.cookie }),
    );
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({
      read: false,
      markerId,
      general: true,
      conceptTitle: `Discussion paper ${run}`,
      route: ['/papers', String(paperId)],
    });
  });
});
