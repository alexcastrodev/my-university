import { describe, expect, it } from 'vitest';
import { BASE, del, get, json, login, post } from './helpers';
import { SEED_PAPERS } from './papers-seed';
import { makePdf } from './pdf-fixtures';

/**
 * Live stack, like discussions.spec: a paper's discussion is the one concept pages use (same endpoints,
 * same authorization, same notifications), keyed `paper:<slug>`. The papers are the seed files the stack serves, so
 * a board keeps what earlier runs wrote and the assertions are about what this run adds.
 */
const run = Math.random().toString(36).slice(2, 8);
const { slug: paperId, title: paperTitle } = SEED_PAPERS[0];
/** A well-formed slug that no paper has. */
const UNKNOWN_ID = `no-such-paper-${run}`;

const topic = (slug: string = paperId) => ({
  module: 'papers',
  slug,
  lang: 'en',
});

const general = async (slug?: string, cookie?: string) =>
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

describe('discussion on a paper page', () => {
  it('is public: anyone can read it without a session', async () => {
    const res = await general();
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      commentCount: expect.any(Number),
      threads: expect.any(Array),
    });
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

  it('has one spelling per paper: the slug in lowercase, anything else is refused', async () => {
    const ana = await login(`paper-pad-${run}`);
    const shouting = await post(
      '/discussions/general',
      { ...topic(paperId.toUpperCase()), body: 'upper-case id' },
      { Cookie: ana.cookie },
    );
    expect(shouting.status).toBe(400);

    const created = await json<{ markerId: number }>(
      await post(
        '/discussions/general',
        { ...topic(), body: 'the one spelling' },
        { Cookie: ana.cookie },
      ),
    );
    const plain = await json<any>(await general());
    expect(plain.id).toBe(created.markerId);
  });

  it('answers 404 for a paper that does not exist, on read and on write', async () => {
    const ana = await login(`paper-404-${run}`);
    expect((await general(UNKNOWN_ID)).status).toBe(404);
    const res = await post(
      '/discussions/general',
      { ...topic(UNKNOWN_ID), body: 'nobody home' },
      { Cookie: ana.cookie },
    );
    expect(res.status).toBe(404);
  });

  it("answers 404 for a reader's private paper, even to its owner, on read and on write", async () => {
    const ana = await login(`paper-private-${run}`);
    const made = await fetch(
      `${BASE}/paper-library/private?title=${encodeURIComponent(`Private discussion ${run}`)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', Cookie: ana.cookie },
        body: makePdf() as BodyInit,
      },
    );
    expect(made.status).toBe(201);
    const { paperId: privateId } = await json<{ paperId: string }>(made);

    expect((await general(privateId)).status).toBe(404);
    expect((await general(privateId, ana.cookie)).status).toBe(404);
    const res = await post(
      '/discussions/general',
      { ...topic(privateId), body: 'talking to myself' },
      { Cookie: ana.cookie },
    );
    expect(res.status).toBe(404);

    await del(`/paper-library/${privateId}`, { Cookie: ana.cookie });
  });

  it.each([
    ['a slug no paper has', 'not-a-paper'],
    ['digits only, as the integer a paper had before public ids', '3105'],
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
        quote: paperTitle,
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
      conceptTitle: paperTitle,
      route: ['/papers', paperId],
    });
  });
});
