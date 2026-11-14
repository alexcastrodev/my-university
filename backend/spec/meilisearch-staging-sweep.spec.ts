import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { MeilisearchClient } from '../src/search/meilisearch.client';

// The sweep of orphaned staging indexes, against a fake Meilisearch behind `fetch`: what it deletes and,
// as important, what it leaves alone (the live indexes, another replica's rebuild in progress).
// And the lock that lets one replica at a time rebuild an index.

const MIN = 60_000;

/** The sweep never touches Postgres, so it gets a DataSource that would blow up if it did. */
const client = () => new MeilisearchClient({} as DataSource);

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

    await client().sweepStaging('content');

    expect(deleted).toEqual([stale]);
  });

  it('does not throw when Meilisearch is down: the rebuild must go on', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('fetch failed')));

    await expect(client().sweepStaging('content')).resolves.toBeUndefined();
  });
});

describe('rebuild lock', () => {
  it('takes the advisory lock before touching Meilisearch and releases it when the rebuild fails', async () => {
    const log: string[] = [];
    const dataSource = {
      createQueryRunner: () => ({
        connect: () => Promise.resolve(),
        query: (sql: string) => {
          log.push(sql);
          return Promise.resolve();
        },
        release: () => {
          log.push('release');
          return Promise.resolve();
        },
      }),
    } as unknown as DataSource;
    vi.stubGlobal('fetch', () => {
      log.push('fetch');
      return Promise.reject(new Error('fetch failed'));
    });

    await expect(
      new MeilisearchClient(dataSource).rebuild({
        index: 'content',
        settings: {},
        documents: [],
      }),
    ).rejects.toThrow('fetch failed');

    expect(log[0]).toContain('pg_advisory_lock');
    expect(log.indexOf('fetch')).toBeGreaterThan(0);
    expect(log.at(-2)).toContain('pg_advisory_unlock');
    expect(log.at(-1)).toBe('release');
  });
});
