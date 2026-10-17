import { describe, expect, it } from 'vitest';
import { get, json } from './helpers';

describe('GET /search: malformed query strings', () => {
  it('treats a repeated q as an empty term instead of failing', async () => {
    const res = await get('/search?q=java&q=spring');
    expect(res.status).toBe(200);
    expect((await json<any>(res)).results).toEqual([]);
  });

  it('caps an oversized term', async () => {
    const res = await get(`/search?q=${'a'.repeat(5000)}`);
    expect(res.status).toBe(200);
    expect((await json<any>(res)).query.length).toBeLessThanOrEqual(200);
  });
});
