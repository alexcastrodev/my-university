import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json } from './helpers';
import { CatalogApp, startCatalogApp } from './papers-catalog-app';
import { FixturePaper } from './papers-fixtures';

// Requests to the real PapersController (spec/papers-catalog-app.ts), which reads the public papers from
// files (#213). Each describe boots the app on a folder of fixtures it writes itself, sends a request and
// asserts on the response. Nothing here depends on the real seed; papers-seed.spec.ts covers that.

interface Summary {
  id: string;
  title: string;
  originalTitle: string | null;
  authors: string[];
  keywords: string[];
  venue: string | null;
  publicationDate: string | null;
  doi: string | null;
  url: string | null;
  researchArea: string | null;
  type: string;
  stage: string;
  excerpt: string | null;
}
interface Page {
  items: Summary[];
  total: number;
  page: number;
  limit: number;
}

const LONG_ABSTRACT = `${'Consensus '.repeat(40)}ends here.`;

const PAPERS: FixturePaper[] = [
  {
    slug: 'transformers-survey',
    title: 'Transformers Survey',
    authors: ['Ada Lovelace', 'Hopper, Grace'],
    type: 'journal-article',
    venue: 'Journal of Specs',
    publicationDate: '2024-05',
    doi: '10.5555/spec.survey',
    url: 'https://example.org/survey',
    researchArea: 'Machine Learning',
    keywords: ['Zeta', 'alpha', ' alpha '],
    abstract: 'We study the catalog.',
    portuguese: { title: 'Uma revisão dos transformers' },
  },
  {
    slug: 'raft-in-practice',
    title: 'Raft in Practice',
    authors: ['Diego Ongaro'],
    type: 'conference-paper',
    publicationDate: '2014-06-19',
    doi: '10.5555/spec.raft',
    researchArea: 'Distributed Systems',
    keywords: ['raft', 'consensus'],
    abstract: 'Replicated logs and leader election.',
  },
  {
    slug: 'old-preprint',
    title: 'An Old Preprint',
    authors: ['Leslie Lamport'],
    type: 'preprint',
    publicationDate: '2019',
    researchArea: 'Distributed Systems',
    keywords: ['consensus'],
  },
  {
    slug: 'a-thesis',
    title: 'A Thesis On Schedulers',
    authors: ['Grace Hopper'],
    type: 'thesis',
    publicationDate: '2022',
    researchArea: 'Operating Systems',
  },
  { slug: 'undated-note', title: 'An Undated Note', type: 'other' },
  {
    slug: 'a-report',
    title: 'A Report',
    authors: ['Ada Lovelace'],
    type: 'report',
    publicationDate: '2024-05-20',
    researchArea: 'Machine Learning',
  },
  {
    slug: 'long-abstract',
    title: 'Long Abstract',
    type: 'conference-paper',
    publicationDate: '2018-03-01',
    abstract: LONG_ABSTRACT,
  },
];

let app: CatalogApp;
const list = async (query = '') => {
  const res = await fetch(`${app.url}/papers?${query}`);
  return { res, page: await json<Page>(res) };
};
/** The slugs a query returns, in order. */
const slugs = async (query = '') =>
  (await list(query)).page.items.map((i) => i.id);
const detail = (slug: string, query = '') =>
  fetch(`${app.url}/papers/${slug}${query}`);

describe('GET /papers', () => {
  beforeAll(async () => {
    app = await startCatalogApp(PAPERS);
  });
  afterAll(() => app.close());

  it('lists the public metadata of a paper, with its authors in order and its keywords', async () => {
    const { res, page } = await list('q=survey');

    expect(res.status).toBe(200);
    expect(page).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(page.items[0]).toEqual({
      id: 'transformers-survey',
      title: 'Transformers Survey',
      originalTitle: null,
      authors: ['Ada Lovelace', 'Hopper, Grace'],
      keywords: ['zeta', 'alpha'],
      venue: 'Journal of Specs',
      publicationDate: '2024-05',
      doi: '10.5555/spec.survey',
      url: 'https://example.org/survey',
      researchArea: 'Machine Learning',
      type: 'journal-article',
      stage: 'published',
      excerpt: 'We study the catalog.',
    });
  });

  it('shows a paper with nothing but the required fields as nulls and empty lists', async () => {
    const { page } = await list('q=undated');

    expect(page.items).toEqual([
      {
        id: 'undated-note',
        title: 'An Undated Note',
        originalTitle: null,
        authors: ['Ada Lovelace'],
        keywords: [],
        venue: null,
        publicationDate: null,
        doi: null,
        url: null,
        researchArea: null,
        type: 'other',
        stage: 'unknown',
        excerpt: null,
      },
    ]);
  });

  it('cuts a long abstract at a word boundary, with an ellipsis', async () => {
    const { page } = await list('q=long');

    const excerpt = page.items[0].excerpt!;
    expect(excerpt.length).toBeLessThanOrEqual(281);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(LONG_ABSTRACT.startsWith(excerpt.slice(0, -1))).toBe(true);
    expect(excerpt.slice(0, -1).endsWith('Consensus')).toBe(true);
  });

  it('returns an empty page, not an error, when nothing matches', async () => {
    const { res, page } = await list('q=zzz-nothing');

    expect(res.status).toBe(200);
    expect(page).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('puts the newest publication first and a paper without a date last', async () => {
    expect(await slugs()).toEqual([
      'a-report',
      'transformers-survey',
      'a-thesis',
      'old-preprint',
      'long-abstract',
      'raft-in-practice',
      'undated-note',
    ]);
    expect(await slugs('sort=recent')).toEqual(await slugs());
  });

  it('can sort by title, ignoring case', async () => {
    expect(await slugs('sort=title')).toEqual([
      'a-report',
      'a-thesis',
      'old-preprint',
      'undated-note',
      'long-abstract',
      'raft-in-practice',
      'transformers-survey',
    ]);
  });

  it.each([
    ['the title', 'q=schedulers', ['a-thesis']],
    ['the abstract', 'q=leader+election', ['raft-in-practice']],
    ['an author', 'q=ongaro', ['raft-in-practice']],
    ['a keyword', 'q=zeta', ['transformers-survey']],
    ['the DOI', 'q=spec.raft', ['raft-in-practice']],
    ['any letter case', 'q=RAFT', ['raft-in-practice']],
  ])('finds a paper by text in %s', async (_name, query, expected) => {
    expect(await slugs(query)).toEqual(expected);
  });

  it.each([
    ['an author, as a part of the name', 'author=hopper', ['transformers-survey', 'a-thesis']],
    ['a keyword, as a whole keyword', 'keyword=consensus', ['old-preprint', 'raft-in-practice']],
    ['a keyword, ignoring case', 'keyword=ALPHA', ['transformers-survey']],
    ['the area, as a whole area', 'area=distributed+systems', ['old-preprint', 'raft-in-practice']],
    ['the type', 'type=conference-paper', ['long-abstract', 'raft-in-practice']],
    ['the stage', 'stage=published', ['transformers-survey', 'long-abstract', 'raft-in-practice']],
    ['the stage thesis', 'stage=thesis', ['a-thesis']],
    ['the year', 'year=2024', ['a-report', 'transformers-survey']],
    ['the DOI', 'doi=10.5555/spec.survey', ['transformers-survey']],
  ])('filters by %s', async (_name, query, expected) => {
    expect(await slugs(query)).toEqual(expected);
  });

  it.each([
    ['https://doi.org/', 'doi=https%3A%2F%2Fdoi.org%2F10.5555%2FSPEC.RAFT'],
    ['doi:', 'doi=doi%3A10.5555%2Fspec.raft'],
    ['a fragment', 'doi=spec.raft'],
  ])('finds a paper by its DOI written as %s', async (_name, query) => {
    expect(await slugs(query)).toEqual(['raft-in-practice']);
  });

  it('does not treat a part of a keyword or of an area as the whole', async () => {
    expect(await slugs('keyword=consens')).toEqual([]);
    expect(await slugs('area=systems')).toEqual([]);
  });

  it('combines every filter with AND', async () => {
    expect(await slugs('area=Machine+Learning&year=2024&author=lovelace')).toEqual([
      'a-report',
      'transformers-survey',
    ]);
    expect(await slugs('area=Machine+Learning&year=2024&author=ongaro')).toEqual([]);
    expect(await slugs('author=hopper&type=thesis&q=schedulers')).toEqual(['a-thesis']);
  });

  it('treats a blank filter as no filter', async () => {
    expect(await slugs('author=&q=+')).toEqual(await slugs());
  });

  it('shows the Portuguese title when asked, and the English one for a paper without a translation', async () => {
    const { page } = await list('lang=pt-BR&sort=title');

    const titles = Object.fromEntries(page.items.map((i) => [i.id, i.title]));
    expect(titles['transformers-survey']).toBe('Uma revisão dos transformers');
    expect(titles['raft-in-practice']).toBe('Raft in Practice');
    expect((await list('lang=fr')).page.items.map((i) => i.title)).toEqual(
      (await list()).page.items.map((i) => i.title),
    );
  });

  it('keeps the published title next to a translated one, and only then', async () => {
    const pt = Object.fromEntries((await list('lang=pt-BR')).page.items.map((i) => [i.id, i.originalTitle]));
    const en = (await list()).page.items.map((i) => i.originalTitle);

    expect(pt['transformers-survey']).toBe('Transformers Survey');
    expect(pt['raft-in-practice']).toBeNull();
    expect(en.every((t) => t === null)).toBe(true);
    expect((await json<any>(await detail('transformers-survey', '?lang=pt-BR'))).originalTitle).toBe('Transformers Survey');
    expect((await json<any>(await detail('transformers-survey'))).originalTitle).toBeNull();
    expect((await json<any>(await detail('raft-in-practice', '?lang=pt-BR'))).originalTitle).toBeNull();
  });

  it('finds a paper by its translated title or by the published one for a Portuguese reader, and only by the published one for the rest', async () => {
    expect(await slugs('lang=pt-BR&q=revis%C3%A3o+dos+transformers')).toEqual(['transformers-survey']);
    expect(await slugs('lang=pt-BR&q=transformers+survey')).toEqual(['transformers-survey']);
    expect(await slugs('q=transformers+survey')).toEqual(['transformers-survey']);
    expect(await slugs('q=revis%C3%A3o+dos+transformers')).toEqual([]);
  });

  it('searches the title the reader sees, in the language of the list', async () => {
    expect(await slugs('lang=pt-BR&q=revis%C3%A3o')).toEqual(['transformers-survey']);
    expect(await slugs('q=revis%C3%A3o')).toEqual([]);
  });

  it.each([
    ['a page below 1', 'page=0'],
    ['a page that is not a number', 'page=first'],
    ['a limit below 1', 'limit=0'],
    ['a limit above the maximum of 50', 'limit=51'],
    ['an unknown type', 'type=zine'],
    ['an unknown stage', 'stage=unpublished'],
    ['a year that is not four digits', 'year=20x4'],
    ['an unknown sort', 'sort=popular'],
    ['a text of more than 200 characters', `q=${'x'.repeat(201)}`],
    ['a filter that does not exist', 'colour=blue'],
  ])('answers 400 for %s', async (_name, query) => {
    expect((await fetch(`${app.url}/papers?${query}`)).status).toBe(400);
  });

  it('does not need a session', async () => {
    const res = await fetch(`${app.url}/papers`, { headers: { Cookie: 'uid=1.forged' } });
    expect(res.status).toBe(200);
  });
});

describe('GET /papers: paging through a catalog of 45 papers', () => {
  const many: FixturePaper[] = Array.from({ length: 45 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      slug: `paper-${n}`,
      title: `Paper ${n}`,
      publicationDate: `${2000 + (i % 20)}-01-${String((i % 20) + 1).padStart(2, '0')}`,
    };
  });
  beforeAll(async () => {
    app = await startCatalogApp(many);
  });
  afterAll(() => app.close());

  it('serves 20 a page by default and says how many there are', async () => {
    const { page } = await list('sort=title');

    expect(page).toMatchObject({ total: 45, page: 1, limit: 20 });
    expect(page.items).toHaveLength(20);
    expect(page.items[0].id).toBe('paper-01');
    expect(page.items[19].id).toBe('paper-20');
  });

  it('serves the next pages, then an empty one past the end', async () => {
    const second = (await list('sort=title&page=2')).page;
    const third = (await list('sort=title&page=3')).page;
    const fourth = (await list('sort=title&page=4')).page;

    expect(second.items.map((i) => i.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `paper-${String(i + 21).padStart(2, '0')}`),
    );
    expect(third.items).toHaveLength(5);
    expect(third.items[4].id).toBe('paper-45');
    expect(fourth).toMatchObject({ items: [], total: 45, page: 4 });
  });

  it('takes the page size from limit, up to 50', async () => {
    expect((await list('limit=7')).page.items).toHaveLength(7);
    expect((await list('limit=50')).page.items).toHaveLength(45);
  });

  it('never repeats or skips a paper across pages in the default order', async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) seen.push(...(await slugs(`page=${page}`)));

    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });

  it('breaks a tie on the date by the slug, so the order never shuffles', async () => {
    const sameDay = [1, 21, 41].map((n) => `paper-${String(n).padStart(2, '0')}`);
    const dated = (await list('limit=50')).page.items.filter((i) => sameDay.includes(i.id));
    expect(new Set(dated.map((i) => i.publicationDate)).size).toBe(1);
    expect(dated.map((i) => i.id)).toEqual(sameDay);
  });
});

describe('publication stage (#201)', () => {
  const kinds = [
    ['journal-article', 'published'],
    ['conference-paper', 'published'],
    ['book-chapter', 'published'],
    ['book', 'published'],
    ['preprint', 'preprint'],
    ['thesis', 'thesis'],
    ['report', 'report'],
    ['other', 'unknown'],
  ];
  beforeAll(async () => {
    app = await startCatalogApp(
      kinds.map(([type]) => ({ slug: `kind-${type}`, title: `Kind ${type}`, type })),
    );
  });
  afterAll(() => app.close());

  it('says where every kind of paper stands, in the list and in the full record', async () => {
    const { page } = await list();
    for (const [type, stage] of kinds) {
      expect(page.items.find((i) => i.id === `kind-${type}`)).toMatchObject({ type, stage });
      expect(await json(await detail(`kind-${type}`))).toMatchObject({ type, stage });
    }
  });
});

describe('GET /papers/facets', () => {
  beforeAll(async () => {
    app = await startCatalogApp(PAPERS);
  });
  afterAll(() => app.close());

  it('counts the research areas and types in the catalog, most used first', async () => {
    const res = await fetch(`${app.url}/papers/facets`);

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      areas: [
        { value: 'Distributed Systems', count: 2 },
        { value: 'Machine Learning', count: 2 },
        { value: 'Operating Systems', count: 1 },
      ],
      types: [
        { value: 'conference-paper', count: 2 },
        { value: 'journal-article', count: 1 },
        { value: 'other', count: 1 },
        { value: 'preprint', count: 1 },
        { value: 'report', count: 1 },
        { value: 'thesis', count: 1 },
      ],
    });
  });
});

describe('GET /papers/:slug', () => {
  beforeAll(async () => {
    app = await startCatalogApp(PAPERS);
  });
  afterAll(() => app.close());

  it('returns the full public record and our analysis of it, and nothing about where it came from', async () => {
    const res = await detail('transformers-survey');

    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(Object.keys(body).sort()).toEqual(
      [
        'abstract', 'abstractTranslated', 'authors', 'availableLanguages', 'doi', 'id', 'keywords', 'language',
        'originalTitle', 'publicationDate', 'researchArea', 'sections', 'stage', 'summary', 'title', 'type',
        'updatedAt', 'url', 'venue', 'version',
      ].sort(),
    );
    expect(body).toMatchObject({
      id: 'transformers-survey',
      title: 'Transformers Survey',
      abstract: 'We study the catalog.',
      doi: '10.5555/spec.survey',
      venue: 'Journal of Specs',
      publicationDate: '2024-05',
      url: 'https://example.org/survey',
      researchArea: 'Machine Learning',
      type: 'journal-article',
      stage: 'published',
      authors: [
        { name: 'Ada Lovelace', orcid: null },
        { name: 'Hopper, Grace', orcid: null },
      ],
      keywords: ['zeta', 'alpha'],
      language: 'en',
      availableLanguages: ['en', 'pt-BR'],
      summary: 'Summary of transformers-survey (en)',
      version: '1.0',
      updatedAt: '2026-01-02',
    });
  });

  it('carries the Research Analysis as six sections, in the order they are read', async () => {
    const body = await json<any>(await detail('transformers-survey'));

    expect(body.sections.map((s: any) => s.title)).toEqual([
      'Overview',
      'Contribution',
      'Methodology',
      'Findings',
      'Critical Analysis',
      'Further Research',
    ]);
    expect(body.sections[0].content).toContain('Our Overview text for transformers-survey (en).');
  });

  it('answers in Portuguese when asked, with the Portuguese section titles', async () => {
    const body = await json<any>(await detail('transformers-survey', '?lang=pt-BR'));

    expect(body).toMatchObject({
      title: 'Uma revisão dos transformers',
      language: 'pt-BR',
      availableLanguages: ['en', 'pt-BR'],
      summary: 'Summary of transformers-survey (pt-BR)',
    });
    expect(body.sections.map((s: any) => s.title)).toEqual([
      'Visão geral',
      'Contribuição',
      'Metodologia',
      'Resultados',
      'Análise crítica',
      'Pesquisas futuras',
    ]);
  });

  it('falls back to English for a paper without a translation, and says so', async () => {
    const body = await json<any>(await detail('raft-in-practice', '?lang=pt-BR'));

    expect(body).toMatchObject({
      title: 'Raft in Practice',
      language: 'en',
      availableLanguages: ['en'],
    });
    expect(body.sections[0].title).toBe('Overview');
  });

  it('treats a language it does not have as English', async () => {
    expect(await json(await detail('transformers-survey', '?lang=fr'))).toMatchObject({
      language: 'en',
    });
  });

  it.each([
    ['a slug no paper has', 'no-such-paper'],
    ['a UUID, which is how a private paper is addressed', '01a191ed-2e04-7235-ae86-8483c518560e'],
    ['the integer a paper had before public ids', '3105'],
    ['the slug in capital letters', 'Transformers-Survey'],
    ['a path that climbs out', '..%2Fpackage'],
  ])('answers 404 for %s', async (_name, slug) => {
    expect((await detail(slug)).status).toBe(404);
  });

  it('does not need a session: nothing in the response depends on the viewer', async () => {
    const anonymous = await json(await detail('transformers-survey'));
    const signed = await json(
      await fetch(`${app.url}/papers/transformers-survey`, { headers: { Cookie: 'uid=1.forged' } }),
    );
    expect(signed).toEqual(anonymous);
  });
});

describe('no route writes to the public papers', () => {
  beforeAll(async () => {
    app = await startCatalogApp(PAPERS);
  });
  afterAll(() => app.close());

  const send = (method: string, path: string) =>
    fetch(`${app.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ title: 'x', authors: [{ name: 'y' }] }),
    });

  it.each([
    ['POST', '/papers'],
    ['POST', '/papers/_test'],
    ['PUT', '/papers/transformers-survey'],
    ['PATCH', '/papers/transformers-survey'],
    ['DELETE', '/papers/transformers-survey'],
    ['DELETE', '/papers/_test/transformers-survey'],
    ['POST', '/papers/transformers-survey/analysis'],
    ['PUT', '/papers/transformers-survey/analysis'],
    ['GET', '/papers/transformers-survey/analysis'],
    ['POST', '/papers/transformers-survey/publish'],
  ])('answers 404 to %s %s, so the list is changed only by changing the files', async (method, path) => {
    expect((await send(method, path)).status).toBe(404);
    expect(await slugs('limit=50')).toHaveLength(PAPERS.length);
  });
});

describe('a mistake in the files', () => {
  const ok: FixturePaper = { slug: 'fine', title: 'Fine' };

  it.each([
    ['a slug that is not lowercase words', { slug: 'Not A Slug', title: 'T' }, /Not A Slug.*slug/],
    ['a date that is not a date', { slug: 'bad-date', title: 'T', publicationDate: 'last year' }, /bad-date.*publicationDate/],
    ['no author', { slug: 'no-author', title: 'T', authors: [] }, /no-author.*author/],
    ['a type that does not exist', { slug: 'bad-type', title: 'T', type: 'zine' }, /bad-type.*type/],
    ['a DOI with a resolver prefix', { slug: 'bad-doi', title: 'T', doi: 'https://doi.org/10.5555/x' }, /bad-doi.*doi/],
    ['a link that is not http', { slug: 'bad-url', title: 'T', url: 'javascript:alert(1)' }, /bad-url.*url/],
  ])('stops the boot for %s, naming the paper', async (_name, broken, message) => {
    await expect(startCatalogApp([ok, broken])).rejects.toThrow(message);
  });

  it('stops the boot for a slug used twice', async () => {
    await expect(startCatalogApp([ok, ok])).rejects.toThrow(/fine.*twice/);
  });

  it('stops the boot for a DOI used twice', async () => {
    await expect(
      startCatalogApp([
        { slug: 'one', title: 'One', doi: '10.5555/same' },
        { slug: 'two', title: 'Two', doi: '10.5555/same' },
      ]),
    ).rejects.toThrow(/two.*DOI/);
  });
});

describe('the texts of a paper in Portuguese', () => {
  const TEXTS: FixturePaper[] = [
    {
      slug: 'paged-attention',
      title: 'Paged Attention',
      type: 'conference-paper',
      publicationDate: '2023-10',
      researchArea: 'Machine Learning Systems',
      keywords: ['LLM serving', 'kv cache'],
      abstract: 'We propose PagedAttention to serve models.',
      portuguese: {
        title: 'Atenção paginada',
        researchArea: 'Sistemas de aprendizado de máquina',
        keywords: ['inferência de llms', 'cache kv'],
        abstract: 'Propomos o PagedAttention para servir modelos.',
      },
    },
    {
      slug: 'half-translated',
      title: 'Half Translated',
      type: 'conference-paper',
      publicationDate: '2022',
      researchArea: 'Databases',
      keywords: ['sql'],
      abstract: 'About relational queries.',
      portuguese: { researchArea: 'Bancos de dados' },
    },
    {
      slug: 'plain-english',
      title: 'Plain English',
      type: 'conference-paper',
      publicationDate: '2021',
      researchArea: 'Databases',
      keywords: ['sql'],
      abstract: 'Replicated logs.',
      portuguese: {},
    },
    {
      slug: 'no-portuguese-file',
      title: 'No Portuguese File',
      type: 'conference-paper',
      publicationDate: '2020',
      researchArea: 'Operating Systems',
      keywords: ['scheduling'],
      abstract: 'Context switches.',
    },
  ];

  beforeAll(async () => {
    app = await startCatalogApp(TEXTS);
  });
  afterAll(() => app.close());

  const byId = (page: Page) => Object.fromEntries(page.items.map((i) => [i.id, i]));

  it('answers the detail with the abstract, keywords and area in Portuguese, and says the abstract is translated', async () => {
    const body = await json<any>(await detail('paged-attention', '?lang=pt-BR'));

    expect(body).toMatchObject({
      language: 'pt-BR',
      title: 'Atenção paginada',
      originalTitle: 'Paged Attention',
      abstract: 'Propomos o PagedAttention para servir modelos.',
      abstractTranslated: true,
      researchArea: 'Sistemas de aprendizado de máquina',
      keywords: ['inferência de llms', 'cache kv'],
      venue: null,
    });
  });

  it('answers the detail in English with the original texts, whatever the translation says', async () => {
    const body = await json<any>(await detail('paged-attention'));

    expect(body).toMatchObject({
      abstract: 'We propose PagedAttention to serve models.',
      abstractTranslated: false,
      researchArea: 'Machine Learning Systems',
      keywords: ['llm serving', 'kv cache'],
    });
    expect((await json<any>(await detail('paged-attention', '?lang=fr'))).researchArea).toBe('Machine Learning Systems');
  });

  it('translates only what the index translates and leaves the rest in English', async () => {
    const half = await json<any>(await detail('half-translated', '?lang=pt-BR'));
    const plain = await json<any>(await detail('plain-english', '?lang=pt-BR'));

    expect(half).toMatchObject({
      researchArea: 'Bancos de dados',
      keywords: ['sql'],
      abstract: 'About relational queries.',
      abstractTranslated: false,
    });
    expect(plain).toMatchObject({
      researchArea: 'Databases',
      abstract: 'Replicated logs.',
      abstractTranslated: false,
    });
  });

  it('shows English when the paper has no file in Portuguese', async () => {
    const body = await json<any>(await detail('no-portuguese-file', '?lang=pt-BR'));

    expect(body).toMatchObject({
      language: 'en',
      originalTitle: null,
      abstract: 'Context switches.',
      abstractTranslated: false,
      researchArea: 'Operating Systems',
      keywords: ['scheduling'],
    });
  });

  it('lists the excerpt, keywords and area in Portuguese for a Portuguese reader, and in English for the rest', async () => {
    const pt = byId((await list('lang=pt-BR')).page);
    const en = byId((await list()).page);

    expect(pt['paged-attention']).toMatchObject({
      excerpt: 'Propomos o PagedAttention para servir modelos.',
      researchArea: 'Sistemas de aprendizado de máquina',
      keywords: ['inferência de llms', 'cache kv'],
    });
    expect(pt['no-portuguese-file']).toMatchObject({ excerpt: 'Context switches.', researchArea: 'Operating Systems' });
    expect(en['paged-attention']).toMatchObject({
      excerpt: 'We propose PagedAttention to serve models.',
      researchArea: 'Machine Learning Systems',
      keywords: ['llm serving', 'kv cache'],
    });
  });

  it('offers the areas in the language of the reader, counted by what the list shows', async () => {
    const facets = async (lang: string) =>
      (await json<{ areas: { value: string; count: number }[] }>(await fetch(`${app.url}/papers/facets?lang=${lang}`))).areas;

    expect(await facets('pt-BR')).toEqual([
      { value: 'Databases', count: 1 },
      { value: 'Bancos de dados', count: 1 },
      { value: 'Operating Systems', count: 1 },
      { value: 'Sistemas de aprendizado de máquina', count: 1 },
    ].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)));
    expect(await facets('en')).toEqual([
      { value: 'Databases', count: 2 },
      { value: 'Machine Learning Systems', count: 1 },
      { value: 'Operating Systems', count: 1 },
    ]);
  });

  it('filters by the area or the keyword in either language, so a link survives the switch of language', async () => {
    const found = (q: string) => slugs(`lang=pt-BR&${q}`);

    expect(await found('area=Sistemas+de+aprendizado+de+m%C3%A1quina')).toEqual(['paged-attention']);
    expect(await found('area=machine+learning+systems')).toEqual(['paged-attention']);
    expect(await found('keyword=infer%C3%AAncia+de+llms')).toEqual(['paged-attention']);
    expect(await found('keyword=kv+cache')).toEqual(['paged-attention']);
    // English readers do not get Portuguese terms.
    expect(await slugs('area=Sistemas+de+aprendizado+de+m%C3%A1quina')).toEqual([]);
  });

  it('searches the abstract in both languages for a Portuguese reader, and only in English for the rest', async () => {
    expect(await slugs('lang=pt-BR&q=propomos')).toEqual(['paged-attention']);
    expect(await slugs('lang=pt-BR&q=we+propose')).toEqual(['paged-attention']);
    expect(await slugs('q=propomos')).toEqual([]);
  });
});
