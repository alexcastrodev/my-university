import { beforeAll, describe, expect, it } from 'vitest';
import { get, json, login, post, put } from './helpers';

/** Live stack, like discussions.spec: paragraph threads and the lab share the reply path. */
const MODULE = 'java-concepts';
let slug: string;
let quote: string;
let block = 1500;

beforeAll(async () => {
  const concepts = await json<any[]>(await get(`/${MODULE}`));
  slug = concepts[0].slug;
  const detail = await json<any>(await get(`/${MODULE}/${slug}`));
  const lines: string[] = detail.sections.flatMap((s: any) =>
    s.content.split('\n'),
  );
  const plain = lines.find((l) => /^[A-Za-z][A-Za-z ,.]{50,}$/.test(l.trim()));
  quote = (plain ?? '').trim().slice(0, 80);
  if (!quote) throw new Error('no paragraph found to quote');
});

const open = async (cookie: string) => {
  const res = await post(
    '/discussions/threads',
    {
      module: MODULE,
      slug,
      lang: 'en',
      anchorKey: 'abcdef0123456789',
      blockIndex: ++block,
      quote,
      body: 'A question',
    },
    { Cookie: cookie },
  );
  expect(res.status).toBe(201);
  return json<{ markerId: number; commentId: number }>(res);
};

const reply = async (cookie: string, markerId: number, parentId: number) => {
  const res = await post(
    `/discussions/markers/${markerId}/comments`,
    { parentId, body: 'An answer' },
    { Cookie: cookie },
  );
  expect(res.status).toBe(201);
  return res;
};

const inbox = async (cookie: string) =>
  json<{ unread: number; items: any[] }>(
    await get('/discussions/notifications', { Cookie: cookie }),
  );

describe('reply notifications', () => {
  it('notifies the author of the comment that got a reply, then marks it read', async () => {
    const ana = await login(`notif-a-${Date.now()}`);
    const bia = await login(`notif-b-${Date.now()}`);
    const { markerId, commentId } = await open(ana.cookie);
    await reply(bia.cookie, markerId, commentId);

    const before = await inbox(ana.cookie);
    expect(before.unread).toBe(1);
    expect(before.items[0]).toMatchObject({
      read: false,
      markerId,
      lab: false,
    });
    expect(before.items[0].route.length).toBeGreaterThan(0);

    expect(
      (
        await post(
          '/discussions/notifications/read',
          {},
          { Cookie: ana.cookie },
        )
      ).status,
    ).toBe(204);
    expect((await inbox(ana.cookie)).unread).toBe(0);
  });

  it('never notifies the replier about their own reply', async () => {
    const ana = await login(`notif-self-${Date.now()}`);
    const { markerId, commentId } = await open(ana.cookie);
    await reply(ana.cookie, markerId, commentId);
    expect((await inbox(ana.cookie)).unread).toBe(0);
  });

  it('notifies the author of a reply that was answered, and the thread owner', async () => {
    const ana = await login(`notif-n-a-${Date.now()}`);
    const bia = await login(`notif-n-b-${Date.now()}`);
    const cai = await login(`notif-n-c-${Date.now()}`);
    const { markerId, commentId } = await open(ana.cookie);
    const first = await json<{ commentId: number }>(
      await reply(bia.cookie, markerId, commentId),
    );
    await reply(cai.cookie, markerId, first.commentId);
    expect((await inbox(bia.cookie)).unread).toBe(1);
    expect((await inbox(ana.cookie)).unread).toBe(2);
  });

  it('creates nothing for someone who turned replies off', async () => {
    const ana = await login(`notif-off-a-${Date.now()}`);
    const bia = await login(`notif-off-b-${Date.now()}`);
    const off = await put(
      '/auth/settings',
      { notifyReplies: false },
      { Cookie: ana.cookie },
    );
    expect((await json<any>(off)).notifyReplies).toBe(false);
    const { markerId, commentId } = await open(ana.cookie);
    await reply(bia.cookie, markerId, commentId);
    expect((await inbox(ana.cookie)).unread).toBe(0);
  });

  it('keeps one reader out of another reader inbox', async () => {
    const res = await get('/discussions/notifications');
    expect(res.status).toBe(401);
  });
});
