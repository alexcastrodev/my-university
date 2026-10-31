import { describe, expect, it } from 'vitest';
import { BASE, del, get, json, login, post, put } from './helpers';
import { SEED_PAPERS } from './papers-seed';

/**
 * Live stack: the real seed files (src/seed/data/papers) as the API serves them. Adding or editing a paper is a
 * change to those files, so this is what protects a change from shipping a paper that does not load, has no
 * Portuguese analysis, or breaks the style rules of the content.
 */
const EN = ['Overview', 'Contribution', 'Methodology', 'Findings', 'Critical Analysis', 'Further Research'];
const PT = ['Visão geral', 'Contribuição', 'Metodologia', 'Resultados', 'Análise crítica', 'Pesquisas futuras'];
const DASHES = /[—–]/;

interface Page {
  items: { id: string; title: string; authors: string[]; doi: string | null; type: string; researchArea: string | null }[];
  total: number;
}

const list = async (query = '') => {
  const res = await get(`/papers?limit=50${query}`);
  expect(res.status).toBe(200);
  return json<Page>(res);
};

describe('the seed is a usable catalog', () => {
  it('has papers, each with a distinct slug and a distinct DOI', () => {
    expect(SEED_PAPERS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SEED_PAPERS.map((p) => p.slug)).size).toBe(SEED_PAPERS.length);
    const dois = SEED_PAPERS.map((p) => p.doi).filter(Boolean);
    expect(new Set(dois).size).toBe(dois.length);
  });

  it('lists every paper of the files, with the authors in the order the files give them', async () => {
    const page = await list();

    expect(page.total).toBe(SEED_PAPERS.length);
    const bySlug = new Map(page.items.map((i) => [i.id, i]));
    for (const paper of SEED_PAPERS) {
      expect(bySlug.get(paper.slug), paper.slug).toMatchObject({
        title: paper.title,
        authors: paper.authors.map((a) => a.name),
        doi: paper.doi ?? null,
        type: paper.type,
        researchArea: paper.researchArea ?? null,
      });
    }
  });

  it('lists the newest publication first', async () => {
    const dates = (await list()).items.map((i) => SEED_PAPERS.find((p) => p.slug === i.id)!.publicationDate ?? '');
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('offers as filter values the areas and types of the files', async () => {
    const facets = await json<{ areas: { value: string; count: number }[]; types: { value: string; count: number }[] }>(
      await get('/papers/facets'),
    );

    const areas = new Set(SEED_PAPERS.map((p) => p.researchArea).filter(Boolean));
    expect(new Set(facets.areas.map((a) => a.value))).toEqual(areas);
    expect(facets.areas.reduce((n, a) => n + a.count, 0)).toBe(
      SEED_PAPERS.filter((p) => p.researchArea).length,
    );
    expect(new Set(facets.types.map((t) => t.value))).toEqual(new Set(SEED_PAPERS.map((p) => p.type)));
  });

  it('offers the areas in Portuguese to a Portuguese reader, one for each English area', async () => {
    const facets = await json<{ areas: { value: string; count: number }[] }>(await get('/papers/facets?lang=pt-BR'));

    const areas = new Set(SEED_PAPERS.map((p) => p.pt.researchArea));
    expect(new Set(facets.areas.map((a) => a.value))).toEqual(areas);
    expect(areas.size).toBe(new Set(SEED_PAPERS.map((p) => p.researchArea)).size);
    expect(facets.areas.reduce((n, a) => n + a.count, 0)).toBe(SEED_PAPERS.length);
  });

  it.each([...new Set(SEED_PAPERS.map((p) => p.researchArea!).filter(Boolean))])(
    'filters by the area %s and finds exactly the papers of that area',
    async (area) => {
      const page = await list(`&area=${encodeURIComponent(area)}`);
      expect(page.items.map((i) => i.id).sort()).toEqual(
        SEED_PAPERS.filter((p) => p.researchArea === area).map((p) => p.slug).sort(),
      );
    },
  );

  // A paper that has no DOI (a USENIX one) is found by its link and its authors only.
  it.each(SEED_PAPERS.filter((p) => p.doi).map((p) => [p.slug, p.doi!]))('finds %s by its DOI', async (slug, doi) => {
    expect((await list(`&doi=${encodeURIComponent(doi)}`)).items.map((i) => i.id)).toEqual([slug]);
  });

  it.each(SEED_PAPERS.map((p) => [p.slug, p.authors[0].name]))('finds %s by its first author', async (slug, author) => {
    expect((await list(`&author=${encodeURIComponent(author)}`)).items.map((i) => i.id)).toContain(slug);
  });
});

describe.each(SEED_PAPERS.map((p) => [p.slug, p] as const))('the seed paper %s', (slug, meta) => {
  it('answers with the record of the files and the English analysis in six sections', async () => {
    const res = await get(`/papers/${slug}`);

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body).toMatchObject({
      id: slug,
      title: meta.title,
      abstract: meta.abstract ?? null,
      doi: meta.doi ?? null,
      venue: meta.venue ?? null,
      publicationDate: meta.publicationDate ?? null,
      type: meta.type,
      authors: meta.authors.map((a) => ({ name: a.name, orcid: a.orcid ?? null })),
      language: 'en',
      availableLanguages: ['en', 'pt-BR'],
    });
    expect(body.version).toMatch(/^\d+\.\d+$/);
    expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.summary).toBeTruthy();
    expect(body.sections.map((s: any) => s.title)).toEqual(EN);
    for (const section of body.sections) expect(section.content.length).toBeGreaterThan(150);
  });

  it('answers in Portuguese with the Portuguese analysis, which is not the English text', async () => {
    const en = await json<any>(await get(`/papers/${slug}`));
    const res = await get(`/papers/${slug}?lang=pt-BR`);

    expect(res.status).toBe(200);
    const pt = await json<any>(res);
    expect(pt).toMatchObject({ id: slug, language: 'pt-BR', version: en.version, updatedAt: en.updatedAt });
    expect(pt.sections.map((s: any) => s.title)).toEqual(PT);
    expect(pt.summary).not.toBe(en.summary);
    pt.sections.forEach((s: any, i: number) => expect(s.content).not.toBe(en.sections[i].content));
  });

  it('translates the abstract, the keywords and the area for a Portuguese reader, and leaves English alone', async () => {
    const pt = meta.pt;
    expect(pt.researchArea, 'researchArea').toBeTruthy();
    expect(pt.keywords.length, 'one keyword for each English keyword').toBe(meta.keywords!.length);
    expect(!!pt.abstract, 'abstract is translated exactly when the paper has one').toBe(!!meta.abstract);

    const body = await json<any>(await get(`/papers/${slug}?lang=pt-BR`));
    expect(body).toMatchObject({
      researchArea: pt.researchArea,
      keywords: pt.keywords.map((k) => k.toLowerCase()),
      abstract: pt.abstract ?? null,
      abstractTranslated: !!meta.abstract,
      title: expect.any(String),
      venue: meta.venue ?? null,
    });
    expect(body.researchArea).not.toBe(meta.researchArea);
    const en = await json<any>(await get(`/papers/${slug}`));
    expect(en).toMatchObject({ researchArea: meta.researchArea, abstract: meta.abstract ?? null, abstractTranslated: false });
  });

  it('keeps the abstract out of the analysis, which is the six sections of the file', async () => {
    for (const lang of ['en', 'pt-BR']) {
      const body = await json<any>(await get(`/papers/${slug}?lang=${lang}`));
      expect(body.sections.map((s: any) => s.title), lang).toEqual(lang === 'en' ? EN : PT);
    }
  });

  it('is found in the list by the area in either language, and shows the Portuguese area and excerpt', async () => {
    const pt = meta.pt;
    for (const area of [pt.researchArea!, meta.researchArea!]) {
      const page = await list(`&lang=pt-BR&area=${encodeURIComponent(area)}`);
      expect(page.items.map((i) => i.id), area).toContain(slug);
    }
    const row = (await list('&lang=pt-BR')).items.find((i) => i.id === slug)! as any;
    expect(row.researchArea).toBe(pt.researchArea);
    if (pt.abstract) expect(row.excerpt.startsWith(pt.abstract.slice(0, 40))).toBe(true);
  });

  it('has no em dash or en dash in what it says, in either language', async () => {
    for (const lang of ['en', 'pt-BR']) {
      const body = JSON.stringify(await json(await get(`/papers/${slug}?lang=${lang}`)));
      expect(DASHES.test(body), lang).toBe(false);
    }
  });
});

describe('the sitemap', () => {
  it('lists every paper in both languages', async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);

    expect(res.status).toBe(200);
    const xml = await res.text();
    for (const { slug } of SEED_PAPERS) {
      expect(xml, slug).toContain(`/papers/${slug}</loc>`);
      expect(xml, slug).toContain(`/pt-BR/papers/${slug}</loc>`);
    }
  });
});

describe('nobody writes to the public list', () => {
  it.each([
    ['POST', '/papers'],
    ['POST', '/papers/_test'],
    ['PUT', `/papers/${SEED_PAPERS[0].slug}`],
    ['DELETE', `/papers/${SEED_PAPERS[0].slug}`],
    ['PUT', `/papers/${SEED_PAPERS[0].slug}/analysis`],
    ['POST', `/papers/${SEED_PAPERS[0].slug}/publish`],
    ['POST', '/auth/_test/roles'],
  ])('answers 404 to %s %s, even to a signed-in reader', async (method, path) => {
    const ana = await login(`seed-write-${Math.random().toString(36).slice(2, 8)}`);
    const body = { title: 'x', authors: [{ name: 'y' }], roles: ['curator'] };
    const res =
      method === 'POST'
        ? await post(path, body, { Cookie: ana.cookie })
        : method === 'PUT'
          ? await put(path, body, { Cookie: ana.cookie })
          : await del(path, { Cookie: ana.cookie });

    expect(res.status).toBe(404);
    expect((await list()).total).toBe(SEED_PAPERS.length);
  });
});
