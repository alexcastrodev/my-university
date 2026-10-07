import { beforeAll, describe, expect, it } from 'vitest';
import { del, get, json, login, post, put } from './helpers';

/** Runs against a live stack like the other specs; the discussion API is the same on every concept track. */
const MODULE = 'java-concepts';
let slug: string;
let quote: string;
let block = 0;

const topic = () => `module=${MODULE}&slug=${slug}&lang=en`;

/** A fresh block index per test, so threads from different tests never share a marker by accident. */
function newThread(
  cookie: string,
  body = 'What does this mean in practice?',
  index = ++block,
) {
  return post(
    '/discussions/threads',
    {
      module: MODULE,
      slug,
      lang: 'en',
      anchorKey: 'abcdef0123456789',
      blockIndex: index,
      quote,
      body,
    },
    { Cookie: cookie },
  );
}

async function openThread(cookie: string, index?: number) {
  const created = await json<{ markerId: number; commentId: number }>(
    await newThread(cookie, undefined, index),
  );
  return created;
}

async function marker(id: number, cookie?: string) {
  return json<any>(
    await get(`/discussions/markers/${id}`, cookie ? { Cookie: cookie } : {}),
  );
}

beforeAll(async () => {
  const concepts = await json<any[]>(await get(`/${MODULE}`));
  slug = concepts[0].slug;
  const detail = await json<any>(await get(`/${MODULE}/${slug}`));
  const lines: string[] = detail.sections.flatMap((s: any) =>
    s.content.split('\n'),
  );
  const plain = lines.find((l) => /^[A-Za-z][A-Za-z ,.]{50,}$/.test(l.trim()));
  const fallback = lines.find(
    (l) => l.trim().length >= 40 && !/^(#|```|\||-|\*)/.test(l.trim()),
  );
  quote = (plain ?? fallback ?? '').trim().slice(0, 80);
  if (!quote) throw new Error('no paragraph found to quote');
});

describe('discussions: validation and access', () => {
  it('needs a session to write', async () => {
    const res = await post('/discussions/threads', {
      module: MODULE,
      slug,
      lang: 'en',
      anchorKey: 'abcdef01',
      blockIndex: 0,
      quote,
      body: 'hi',
    });
    expect(res.status).toBe(401);
  });

  it('lets anyone read the summary, uncached', async () => {
    const res = await get(`/discussions?${topic()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('404s for a concept that does not exist', async () => {
    expect(
      (await get(`/discussions?module=${MODULE}&slug=no-such-concept&lang=en`))
        .status,
    ).toBe(404);
    expect(
      (await get(`/discussions?module=no-such-module&slug=${slug}&lang=en`))
        .status,
    ).toBe(404);
  });

  it('rejects a quote that is not in the concept', async () => {
    const { cookie } = await login(`disc-forged-${Date.now()}`);
    const res = await post(
      '/discussions/threads',
      {
        module: MODULE,
        slug,
        lang: 'en',
        anchorKey: 'abcdef01',
        blockIndex: 1,
        quote: 'Send your password to this address',
        body: 'hi',
      },
      { Cookie: cookie },
    );
    expect(res.status).toBe(404);
  });

  it('rejects unknown fields and an unsupported language', async () => {
    const { cookie } = await login(`disc-fields-${Date.now()}`);
    const extra = await post(
      '/discussions/threads',
      {
        module: MODULE,
        slug,
        lang: 'en',
        anchorKey: 'abcdef01',
        blockIndex: 1,
        quote,
        body: 'hi',
        authorId: 1,
      },
      { Cookie: cookie },
    );
    expect(extra.status).toBe(400);
    const lang = await post(
      '/discussions/threads',
      {
        module: MODULE,
        slug,
        lang: 'fr',
        anchorKey: 'abcdef01',
        blockIndex: 1,
        quote,
        body: 'hi',
      },
      { Cookie: cookie },
    );
    expect(lang.status).toBe(400);
  });

  it('rejects an empty or oversized comment', async () => {
    const { cookie } = await login(`disc-body-${Date.now()}`);
    expect((await newThread(cookie, '   ')).status).toBe(400);
    expect((await newThread(cookie, 'x'.repeat(2001))).status).toBe(400);
  });
});

describe('discussions: threads, replies and votes', () => {
  it('opens a thread, shows it in the summary, and reuses the marker for the same block', async () => {
    const ana = await login(`disc-ana-${Date.now()}`);
    const bia = await login(`disc-bia-${Date.now()}`);
    const index = ++block;
    const first = await openThread(ana.cookie, index);
    const second = await openThread(bia.cookie, index);
    expect(second.markerId).toBe(first.markerId);

    const summary = await json<any[]>(await get(`/discussions?${topic()}`));
    const entry = summary.find((m) => m.id === first.markerId);
    expect(entry).toMatchObject({
      commentCount: 2,
      resolvedCount: 0,
      blockIndex: index,
    });

    const detail = await marker(first.markerId, ana.cookie);
    expect(detail.threads).toHaveLength(2);
    expect(detail.threads[0].root).toMatchObject({ mine: true, votes: 0 });
    expect(detail.threads[1].root.mine).toBe(false);
  });

  it('attaches a reply to a reply to the thread root', async () => {
    const ana = await login(`disc-reply-a-${Date.now()}`);
    const bia = await login(`disc-reply-b-${Date.now()}`);
    const { markerId, commentId } = await openThread(ana.cookie);
    const reply = await json<{ commentId: number }>(
      await post(
        `/discussions/markers/${markerId}/comments`,
        { parentId: commentId, body: 'First answer' },
        { Cookie: bia.cookie },
      ),
    );
    const nested = await post(
      `/discussions/markers/${markerId}/comments`,
      { parentId: reply.commentId, body: 'Following up' },
      { Cookie: ana.cookie },
    );
    expect(nested.status).toBe(201);

    const detail = await marker(markerId);
    expect(detail.threads).toHaveLength(1);
    expect(detail.threads[0].replies).toHaveLength(2);
  });

  it('refuses a reply to a comment of another marker', async () => {
    const ana = await login(`disc-cross-${Date.now()}`);
    const one = await openThread(ana.cookie);
    const two = await openThread(ana.cookie);
    const res = await post(
      `/discussions/markers/${two.markerId}/comments`,
      { parentId: one.commentId, body: 'wrong place' },
      { Cookie: ana.cookie },
    );
    expect(res.status).toBe(404);
  });

  it('counts one vote per reader, never on your own comment', async () => {
    const ana = await login(`disc-vote-a-${Date.now()}`);
    const bia = await login(`disc-vote-b-${Date.now()}`);
    const { markerId, commentId } = await openThread(ana.cookie);

    expect(
      (
        await put(
          `/discussions/comments/${commentId}/vote`,
          {},
          { Cookie: ana.cookie },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await put(
          `/discussions/comments/${commentId}/vote`,
          {},
          { Cookie: bia.cookie },
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await put(
          `/discussions/comments/${commentId}/vote`,
          {},
          { Cookie: bia.cookie },
        )
      ).status,
    ).toBe(204);

    const seenByBia = await marker(markerId, bia.cookie);
    expect(seenByBia.threads[0].root).toMatchObject({
      votes: 1,
      votedByMe: true,
    });
    expect((await marker(markerId, ana.cookie)).threads[0].root).toMatchObject({
      votes: 1,
      votedByMe: false,
    });

    await del(`/discussions/comments/${commentId}/vote`, {
      Cookie: bia.cookie,
    });
    expect((await marker(markerId)).threads[0].root.votes).toBe(0);
  });
});

describe('discussions: the thread owner resolves', () => {
  async function threadWithReply() {
    const ana = await login(`disc-own-a-${Date.now()}`);
    const bia = await login(`disc-own-b-${Date.now()}`);
    const { markerId, commentId } = await openThread(ana.cookie);
    const { commentId: replyId } = await json<{ commentId: number }>(
      await post(
        `/discussions/markers/${markerId}/comments`,
        { parentId: commentId, body: 'Try an outbox' },
        { Cookie: bia.cookie },
      ),
    );
    return { ana, bia, markerId, commentId, replyId };
  }

  it('only the root author can accept a reply', async () => {
    const { bia, commentId, replyId } = await threadWithReply();
    const res = await put(
      `/discussions/comments/${commentId}/accept`,
      { replyId },
      { Cookie: bia.cookie },
    );
    expect(res.status).toBe(403);
  });

  it('accepting resolves the thread, puts the reply first and can be undone', async () => {
    const { ana, markerId, commentId, replyId } = await threadWithReply();
    expect(
      (
        await put(
          `/discussions/comments/${commentId}/accept`,
          { replyId },
          { Cookie: ana.cookie },
        )
      ).status,
    ).toBe(204);

    const resolved = await marker(markerId);
    expect(resolved.threads[0]).toMatchObject({
      resolved: true,
      acceptedReplyId: replyId,
    });
    const summary = await json<any[]>(await get(`/discussions?${topic()}`));
    expect(summary.find((m) => m.id === markerId).resolvedCount).toBe(1);

    expect(
      (
        await del(`/discussions/comments/${commentId}/accept`, {
          Cookie: ana.cookie,
        })
      ).status,
    ).toBe(204);
    expect((await marker(markerId)).threads[0].resolved).toBe(false);
  });

  it('only accepts a reply that belongs to that thread', async () => {
    const { ana, commentId } = await threadWithReply();
    const other = await threadWithReply();
    const res = await put(
      `/discussions/comments/${commentId}/accept`,
      { replyId: other.replyId },
      { Cookie: ana.cookie },
    );
    expect(res.status).toBe(404);
  });

  it('removing the accepted reply un-resolves the thread', async () => {
    const { ana, bia, markerId, commentId, replyId } = await threadWithReply();
    await put(
      `/discussions/comments/${commentId}/accept`,
      { replyId },
      { Cookie: ana.cookie },
    );
    expect(
      (await del(`/discussions/comments/${replyId}`, { Cookie: ana.cookie }))
        .status,
    ).toBe(403);
    expect(
      (await del(`/discussions/comments/${replyId}`, { Cookie: bia.cookie }))
        .status,
    ).toBe(204);

    const detail = await marker(markerId);
    expect(detail.threads[0]).toMatchObject({ resolved: false, replies: [] });
  });
});

describe('discussions: edit and remove', () => {
  it('only the author edits, and the comment shows as edited', async () => {
    const ana = await login(`disc-edit-a-${Date.now()}`);
    const bia = await login(`disc-edit-b-${Date.now()}`);
    const { markerId, commentId } = await openThread(ana.cookie);

    expect(
      (
        await put(
          `/discussions/comments/${commentId}`,
          { body: 'hijacked' },
          { Cookie: bia.cookie },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await put(
          `/discussions/comments/${commentId}`,
          { body: 'fixed typo' },
          { Cookie: ana.cookie },
        )
      ).status,
    ).toBe(204);

    const root = (await marker(markerId)).threads[0].root;
    expect(root.body).toBe('fixed typo');
    expect(root.editedAt).not.toBeNull();
  });

  it('removing a root with replies leaves a tombstone, and removing the last comment hides the marker', async () => {
    const ana = await login(`disc-del-a-${Date.now()}`);
    const bia = await login(`disc-del-b-${Date.now()}`);
    const { markerId, commentId } = await openThread(ana.cookie);
    const { commentId: replyId } = await json<{ commentId: number }>(
      await post(
        `/discussions/markers/${markerId}/comments`,
        { parentId: commentId, body: 'an answer' },
        { Cookie: bia.cookie },
      ),
    );

    expect(
      (await del(`/discussions/comments/${commentId}`, { Cookie: ana.cookie }))
        .status,
    ).toBe(204);
    const tombstone = (await marker(markerId)).threads[0];
    expect(tombstone.root).toMatchObject({
      deleted: true,
      body: '',
      author: null,
    });
    expect(tombstone.replies).toHaveLength(1);

    await del(`/discussions/comments/${replyId}`, { Cookie: bia.cookie });
    const summary = await json<any[]>(await get(`/discussions?${topic()}`));
    expect(summary.some((m) => m.id === markerId)).toBe(false);
    expect(
      (
        await put(
          `/discussions/comments/${commentId}`,
          { body: 'zombie' },
          { Cookie: ana.cookie },
        )
      ).status,
    ).toBe(404);
  });
});

describe('discussions: flooding', () => {
  it('stops one account after ten comments in a minute', async () => {
    const { cookie } = await login(`disc-flood-${Date.now()}`);
    for (let i = 0; i < 10; i++)
      expect((await newThread(cookie)).status).toBe(201);
    expect((await newThread(cookie)).status).toBe(429);
  });
});
