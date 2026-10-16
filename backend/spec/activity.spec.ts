import { describe, expect, it } from 'vitest';
import { get, json, login, put } from './helpers';


interface Entry { id: number; sourceType: string; sourceId: string; exp: number; updatedAt: string }
interface Page { items: Entry[]; hasMore: boolean }

const page = (cookie: string, query = '') => get(`/xp/history/paged${query}`, { Cookie: cookie });

/** A user with `n` recorded activities (daily-independent: every concept read is one row). */
async function userWithActivity(n: number) {
  const { cookie } = await login(`activity-${n}-${Date.now()}`);
  const list = await json<{ slug: string }[]>(await get('/java-concepts', { Cookie: cookie }));
  const slugs = list.slice(0, n).map((c) => c.slug);
  expect(slugs.length, 'the seed must have enough concepts for this spec').toBe(n);
  for (const slug of slugs) expect((await put(`/java-concepts/${slug}/read`, {}, { Cookie: cookie })).status).toBe(200);
  return cookie;
}

describe('GET /xp/history/paged', () => {
  it('needs a session', async () => {
    expect((await get('/xp/history/paged')).status).toBe(401);
  });

  it('is empty, with nothing more, for a user with no activity', async () => {
    const { cookie } = await login(`activity-none-${Date.now()}`);
    expect(await json<Page>(await page(cookie))).toEqual({ items: [], hasMore: false });
  });

  it('returns newest first and says whether another page exists', async () => {
    const cookie = await userWithActivity(5);
    const first = await json<Page>(await page(cookie, '?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const times = first.items.map((e) => Date.parse(e.updatedAt));
    expect(times[0]).toBeGreaterThanOrEqual(times[1]);
  });

  it('walks the whole history in pages with no repeat and no gap, and the last page says there is no more', async () => {
    const cookie = await userWithActivity(5);
    const everything = await json<Entry[]>(await get('/xp/history', { Cookie: cookie }));

    const seen: number[] = [];
    let offset = 0;
    for (let guard = 0; guard < 10; guard++) {
      const p = await json<Page>(await page(cookie, `?limit=2&offset=${offset}`));
      seen.push(...p.items.map((e) => e.id));
      offset += p.items.length;
      if (!p.hasMore) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(everything.map((e) => e.id).sort((a, b) => a - b));
    expect(seen).toHaveLength(5);
  });

  it('reports no more when the last page is exactly full', async () => {
    const cookie = await userWithActivity(4);
    const p = await json<Page>(await page(cookie, '?limit=4'));
    expect(p.items).toHaveLength(4);
    expect(p.hasMore).toBe(false);
  });

  it('defaults to 20 and clamps nonsense instead of failing', async () => {
    const cookie = await userWithActivity(3);
    for (const q of ['', '?limit=abc', '?limit=-5', '?limit=0', '?offset=-1', '?offset=x', '?limit=999999']) {
      const res = await page(cookie, q);
      expect(res.status, q).toBe(200);
      const p = await json<Page>(res);
      expect(p.items.length, q).toBeLessThanOrEqual(50);
      expect(p.items.length, q).toBeGreaterThan(0);
    }
    expect((await json<Page>(await page(cookie, '?limit=0'))).items).toHaveLength(1);
  });

  it('never shows another user\'s activity', async () => {
    const [a, b] = [await userWithActivity(3), (await login(`activity-other-${Date.now()}`)).cookie];
    expect((await json<Page>(await page(b))).items).toEqual([]);
    expect((await json<Page>(await page(a))).items).toHaveLength(3);
  });

  it('keeps the old unpaged route working for bundles loaded before this change', async () => {
    const cookie = await userWithActivity(2);
    const old = await json<Entry[]>(await get('/xp/history', { Cookie: cookie }));
    expect(Array.isArray(old)).toBe(true);
    expect(old).toHaveLength(2);
  });
});
