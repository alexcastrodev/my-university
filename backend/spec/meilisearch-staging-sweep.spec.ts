import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeilisearchClient } from '../src/search/meilisearch.client';

// The sweep of orphaned staging indexes, against a fake Meilisearch behind `fetch`: what it deletes and,
// as important, what it leaves alone (the live indexes, another replica's rebuild in progress).

const MIN = 60_000;

function fakeMeili(uids: string[]) {
  const deleted: string[] = [];
  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body)));
  vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (init?.method === 'DELETE') {
      deleted.push(path.replace('/indexes/', ''));
      return json({ taskUid: deleted.length });
    }
    if (path.startsWith('/tasks/')) return json({ status: 'succeeded' });
    return json({ results: uids.map((uid) => ({ uid })) });
  });
  return deleted;
}

afterEach(() => vi.unstubAllGlobals());

describe('sweepStaging', () => {
  it('deletes only the stale staging indexes of that index', async () => {
    const now = Date.now();
    const stale = `content_staging_${now - 20 * MIN}`;
    const deleted = fakeMeili([
      'content',
      'content_meta',
      'papers',
      stale,
      `content_staging_${now - MIN}`, // another replica may be building it right now
      `papers_staging_${now - 180 * MIN}`, // stale, but the papers index sweeps its own
      'content_staging_abc', // not one of ours
    ]);

    await new MeilisearchClient().sweepStaging('content');

    expect(deleted).toEqual([stale]);
  });

  it('does not throw when Meilisearch is down: the rebuild must go on', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('fetch failed')));

    await expect(
      new MeilisearchClient().sweepStaging('content'),
    ).resolves.toBeUndefined();
  });
});
