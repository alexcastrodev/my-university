import { describe, it, expect } from 'vitest';
import { get } from './helpers';

describe('GET /sitemap.xml', () => {
  it('returns a valid XML urlset', async () => {
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');

    const body = await res.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
  });

  it('includes the homepage and a known concept detail page', async () => {
    const body = await (await get('/sitemap.xml')).text();
    expect(body).toContain('<loc>https://university.kurz.fyi/</loc>');
    expect(body).toContain(
      '<loc>https://university.kurz.fyi/java/java-concepts/iterator-vs-iterable</loc>',
    );
  });

  it('gives every URL a well-formed lastmod when present', async () => {
    const body = await (await get('/sitemap.xml')).text();
    const lastmods = [...body.matchAll(/<lastmod>(.+?)<\/lastmod>/g)].map(
      (m) => m[1],
    );
    expect(lastmods.length).toBeGreaterThan(0);
    for (const lastmod of lastmods) {
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
