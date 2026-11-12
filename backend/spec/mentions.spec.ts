import { beforeAll, describe, expect, it } from 'vitest';
import { get, json, login, post, put } from './helpers';

/** Live stack, like notifications.spec: mentions ride the same notification table and inbox. */
const MODULE = 'java-concepts';
let slug: string;

beforeAll(async () => {
  const concepts = await json<any[]>(await get(`/${MODULE}`));
  slug = concepts[0].slug;
});

let seq = 0;
/** A signed-in user with a public link name, which is what `@` reaches. */
const person = async (prefix: string) => {
  const user = await login(`${prefix}-${Date.now()}`);
  const handle = `${prefix}-${Date.now().toString(36)}${++seq}`;
  const res = await put(
    '/auth/profile-slug',
    { slug: handle },
    { Cookie: user.cookie },
  );
  expect(res.status).toBe(200);
  return { ...user, handle };
};

const general = async (cookie: string, body: string) =>
  post(
    '/discussions/general',
    { module: MODULE, slug, lang: 'en', body },
    { Cookie: cookie },
  );

const postGeneral = async (cookie: string, body: string) => {
  const res = await general(cookie, body);
  expect(res.status).toBe(201);
  return json<{ markerId: number; commentId: number }>(res);
};

const inbox = async (cookie: string) =>
  json<{ unread: number; items: any[] }>(
    await get('/discussions/notifications', { Cookie: cookie }),
  );

describe('mention notifications', () => {
  it('notifies the person mentioned once, as a mention, even when named twice', async () => {
    const ana = await person('men-a');
    const bia = await person('men-b');
    const { markerId } = await postGeneral(
      bia.cookie,
      `Hey @${ana.handle}, see this. @${ana.handle.toUpperCase()} again`,
    );
    const box = await inbox(ana.cookie);
    expect(box.unread).toBe(1);
    expect(box.items[0]).toMatchObject({
      kind: 'mention',
      markerId,
      general: true,
    });
  });

  it('never notifies the author, an unknown handle or a private profile', async () => {
    const ana = await person('men-self');
    const hidden = await person('men-priv');
    await put(
      '/auth/settings',
      { profilePublic: false },
      { Cookie: hidden.cookie },
    );
    await postGeneral(
      ana.cookie,
      `@${ana.handle} @nobody-here-xyz @${hidden.handle}`,
    );
    expect((await inbox(ana.cookie)).unread).toBe(0);
    expect((await inbox(hidden.cookie)).unread).toBe(0);
  });

  it('keeps the reply notification when the reply also mentions its addressee', async () => {
    const ana = await person('men-r-a');
    const bia = await person('men-r-b');
    const { markerId, commentId } = await postGeneral(ana.cookie, 'A question');
    const res = await post(
      `/discussions/markers/${markerId}/comments`,
      { parentId: commentId, body: `@${ana.handle} here is the answer` },
      { Cookie: bia.cookie },
    );
    expect(res.status).toBe(201);
    const box = await inbox(ana.cookie);
    expect(box.items.map((i) => i.kind)).toEqual(['reply']);
  });

  it('on edit, notifies only the people newly mentioned', async () => {
    const ana = await person('men-e-a');
    const bia = await person('men-e-b');
    const cai = await person('men-e-c');
    const { commentId } = await postGeneral(cai.cookie, `cc @${ana.handle}`);
    const edit = await put(
      `/discussions/comments/${commentId}`,
      { body: `cc @${ana.handle} and @${bia.handle}` },
      { Cookie: cai.cookie },
    );
    expect(edit.status).toBe(204);
    expect((await inbox(ana.cookie)).unread).toBe(1);
    expect((await inbox(bia.cookie)).unread).toBe(1);
  });

  it('creates nothing for someone who turned notifications off', async () => {
    const ana = await person('men-off-a');
    const bia = await person('men-off-b');
    await put(
      '/auth/settings',
      { notifyReplies: false },
      { Cookie: ana.cookie },
    );
    await postGeneral(bia.cookie, `@${ana.handle}`);
    expect((await inbox(ana.cookie)).unread).toBe(0);
  });

  it('refuses a comment that mentions more than ten people', async () => {
    const bia = await person('men-many');
    const body = Array.from({ length: 11 }, (_, i) => `@someone-${i}`).join(
      ' ',
    );
    expect((await general(bia.cookie, body)).status).toBe(400);
  });

  it('lists the resolved mentions on the comment, and only those', async () => {
    const ana = await person('men-l-a');
    const bia = await person('men-l-b');
    await postGeneral(bia.cookie, `@${ana.handle} and @no-such-person-xyz`);
    const detail = await json<any>(
      await get(`/discussions/general?module=${MODULE}&slug=${slug}&lang=en`),
    );
    const mine = detail.threads.find((t: any) =>
      t.root.body.includes(ana.handle),
    );
    expect(mine.root.mentions).toEqual([ana.handle]);
  });
});

describe('mention suggestions', () => {
  it('finds public profiles by handle prefix or name, never the asker', async () => {
    const ana = await person('sug-a');
    const bia = await person('sug-b');
    const found = await json<any[]>(
      await get(`/discussions/mentions?q=${ana.handle.slice(0, 8)}`, {
        Cookie: bia.cookie,
      }),
    );
    expect(found.map((u) => u.handle)).toContain(ana.handle);
    expect(found[0]).toEqual({
      handle: expect.any(String),
      name: expect.any(String),
      avatarUrl: expect.any(String),
    });
    const self = await json<any[]>(
      await get(`/discussions/mentions?q=${bia.handle}`, {
        Cookie: bia.cookie,
      }),
    );
    expect(self.map((u) => u.handle)).not.toContain(bia.handle);
  });

  it('treats LIKE wildcards as text', async () => {
    const bia = await person('sug-w');
    const res = await get('/discussions/mentions?q=%25', {
      Cookie: bia.cookie,
    });
    expect(res.status).toBe(200);
    expect(await json<any[]>(res)).toEqual([]);
  });

  it('needs a session and a bounded query', async () => {
    expect((await get('/discussions/mentions?q=ana')).status).toBe(401);
    const bia = await person('sug-q');
    expect(
      (
        await get(`/discussions/mentions?q=${'a'.repeat(31)}`, {
          Cookie: bia.cookie,
        })
      ).status,
    ).toBe(400);
    expect(
      (await get('/discussions/mentions', { Cookie: bia.cookie })).status,
    ).toBe(400);
  });
});
