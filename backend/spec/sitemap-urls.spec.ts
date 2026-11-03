import { describe, it, expect } from 'vitest';
import { javaConcepts, sitemap } from './sitemap-fixture';

/** Every content track, as the app routes it. A track missing here would silently drop out of search. */
const TRACK_ROOTS = [
  '/papers',
  '/java/java-concepts',
  '/java/jvm-concepts',
  '/databases/database-concepts',
  '/spring-concepts',
  '/system-design/system-design-concepts',
  '/java/testing',
  '/algorithms/algorithms-concepts',
  '/java/java-minute',
  '/ruby-concepts',
  '/rubyonrails-concepts',
  '/dotnet-concepts',
  '/csharp-concepts',
  '/dotnet-testing-concepts',
  '/csharp-minute',
  '/quarkus-concepts',
  '/kubernetes-concepts',
];

describe('sitemap URLs (pure, no API)', () => {
  it('lists every track in English and in pt-BR, with its list page and its items', async () => {
    const paths = new Set((await sitemap.buildUrls()).map((u) => u.path));
    for (const root of TRACK_ROOTS) {
      for (const base of [root, `/pt-BR${root}`]) {
        expect(paths.has(base), `${base} (list page) is listed`).toBe(true);
        expect(
          [...paths].some((p) => p.startsWith(`${base}/`)),
          `${base} has items`,
        ).toBe(true);
      }
    }
  });

  it('lists the curriculum disciplines and their concepts, in English and in pt-BR', async () => {
    const paths = (await sitemap.buildUrls()).map((u) => u.path);
    for (const prefix of ['', '/pt-BR']) {
      expect(
        paths.some((p) =>
          new RegExp(`^${prefix}/computer-science/[^/]+/[^/]+$`).test(p),
        ),
      ).toBe(true);
      expect(
        paths.some((p) =>
          new RegExp(`^${prefix}/computer-science/[^/]+/[^/]+/[^/]+$`).test(p),
        ),
      ).toBe(true);
    }
  });

  it('lists the pages that are not part of a track: home, /tracks and the curriculum in both languages, the exams and every lesson', async () => {
    const paths = (await sitemap.buildUrls()).map((u) => u.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        '/tracks',
        '/computer-science',
        '/pt-BR/',
        '/pt-BR/tracks',
        '/pt-BR/computer-science',
        '/java/exams',
        '/java/exam/java-25',
        '/java/exam/java-25/lesson/j25-0-1',
        '/java/exam/java-25/lesson/j25-0-2',
      ]),
    );
  });

  it('leaves out a skill check, whose questions are drawn in the browser and so has no text to index', async () => {
    const paths = (await sitemap.buildUrls()).map((u) => u.path);
    expect(paths).toContain('/java/exam/java-25/lesson/j25-0-2');
    expect(paths).not.toContain('/java/exam/java-25/lesson/j25-0-9');
  });

  it('never lists a page that is private, per-user or not worth indexing', async () => {
    const paths = (await sitemap.buildUrls()).map((u) => u.path);
    const unwanted =
      /^(\/pt-BR)?\/(library|groups|dashboard|profile|u|login|settings|discussions|leaderboard|map|notifications)(\/|$)|\/java\/exam\/[^/]+\/(quiz|result|review|attempts|share)/;
    expect(paths.filter((p) => unwanted.test(p))).toEqual([]);
  });

  it('lists each URL once', async () => {
    const paths = (await sitemap.buildUrls()).map((u) => u.path);
    expect(paths.length).toBe(new Set(paths).size);
  });

  it('gives only translated items a pt-BR twin', async () => {
    const paths = (await sitemap.buildUrls()).map((u) => u.path);
    expect(paths).toContain('/pt-BR/papers/translated-paper');
    expect(paths).toContain('/papers/english-only-paper');
    expect(paths).not.toContain('/pt-BR/papers/english-only-paper');
  });

  it('puts each page in a complete, reciprocal hreflang set that includes itself', async () => {
    const urls = await sitemap.buildUrls();
    const byPath = new Map(urls.map((u) => [u.path, u]));
    const problems: string[] = [];

    for (const url of urls) {
      if (!url.alternates) continue;
      const set = url.alternates.map((a) => a.path).sort();
      if (!set.includes(url.path))
        problems.push(`${url.path} does not list itself`);
      for (const alt of url.alternates) {
        const target = byPath.get(alt.path);
        if (!target) {
          problems.push(
            `${url.path} points at ${alt.path}, which is not in the sitemap`,
          );
          continue;
        }
        const theirs = (target.alternates ?? []).map((a) => a.path).sort();
        if (theirs.join() !== set.join())
          problems.push(`${url.path} and ${alt.path} disagree on the set`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('dates a page by its updatedAt when it has one, otherwise by publishedAt', async () => {
    const urls = await sitemap.buildUrls();
    const edited = javaConcepts
      .findAll()
      .find((c) => c.updatedAt && c.updatedAt !== c.publishedAt);
    expect(
      edited,
      'the content has at least one concept edited after publishing',
    ).toBeDefined();
    expect(
      urls.find((u) => u.path === `/java/java-concepts/${edited!.slug}`)
        ?.lastmod,
    ).toBe(edited!.updatedAt);
    expect(
      urls.find((u) => u.path === `/pt-BR/java/java-concepts/${edited!.slug}`)
        ?.lastmod,
    ).toBe(edited!.updatedAt);

    const unedited = javaConcepts.findAll().find((c) => !c.updatedAt);
    if (unedited) {
      expect(
        urls.find((u) => u.path === `/java/java-concepts/${unedited.slug}`)
          ?.lastmod,
      ).toBe(unedited.publishedAt);
    }
  });
});

describe('sitemap XML (pure, no API)', () => {
  it('adds x-default, pointing at the English page, to every hreflang set', async () => {
    const xml = await sitemap.toXml();
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://university.kurz.fyi/java/java-concepts/iterator-vs-iterable" />',
    );
    const sets = xml
      .split('<url>')
      .slice(1)
      .filter((entry) => entry.includes('hreflang'));
    expect(sets.length).toBeGreaterThan(0);
    for (const entry of sets) {
      expect(entry.match(/hreflang="x-default"/g)).toHaveLength(1);
      expect(entry.match(/hreflang="en"/g)).toHaveLength(1);
      expect(entry.match(/hreflang="pt-BR"/g)).toHaveLength(1);
    }
  });

  it('leaves out changefreq and priority, which search engines ignore', async () => {
    const xml = await sitemap.toXml();
    expect(xml).not.toContain('<changefreq>');
    expect(xml).not.toContain('<priority>');
  });
});
