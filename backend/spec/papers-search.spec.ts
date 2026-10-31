import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MeilisearchClient } from '../src/search/meilisearch.client';
import { PapersCatalogService } from '../src/papers/papers-catalog.service';
import { PapersSearch } from '../src/papers/papers-search';
import { usePapers } from './papers-fixtures';

// The papers search without a Meilisearch: a fake client stands in for it, so these check what the app sends
// to the index and what the catalog does with the answer (or with no answer), not Meilisearch's matching.

type Rebuild = Parameters<MeilisearchClient['rebuild']>[0];
type Request = Parameters<MeilisearchClient['matchingIds']>[0];

class FakeMeili {
  rebuilds: Rebuild[] = [];
  requests: Request[] = [];
  /** What the next searches answer: ids, or an error to throw. */
  answer: string[] | Error = [];
  rebuild(req: Rebuild): Promise<void> {
    this.rebuilds.push(req);
    return Promise.resolve();
  }

  matchingIds(req: Request): Promise<string[]> {
    this.requests.push(req);
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer);
  }
}

const ENV = ['MEILI_HOST'];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let dropFiles: () => void;
let catalog: PapersCatalogService;

beforeAll(() => {
  dropFiles = usePapers();
  catalog = new PapersCatalogService(null as never);
});
afterAll(() => dropFiles());
afterEach(() => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function searchWith(env: Record<string, string>) {
  Object.assign(process.env, env);
  const meili = new FakeMeili();
  return { meili, search: new PapersSearch(catalog, meili as unknown as MeilisearchClient) };
}

const slugs = (page: { items: { id: string }[] }) => page.items.map((p) => p.id);

describe('the documents of the papers index', () => {
  it('holds every paper in every language, with the English original of what a translation changed', () => {
    const docs = catalog.searchDocuments();
    expect(docs.map((d) => d.id).sort()).toEqual([
      'attention-is-all-you-need_en',
      'attention-is-all-you-need_pt-BR',
      'deep-residual-learning_en',
      'deep-residual-learning_pt-BR',
      'zebra-finches-sing_en',
      'zebra-finches-sing_pt-BR',
    ]);
    const pt = docs.find((d) => d.id === 'attention-is-all-you-need_pt-BR')!;
    expect(pt).toMatchObject({
      slug: 'attention-is-all-you-need',
      language: 'pt-BR',
      title: 'Atenção é tudo que você precisa',
      altTitle: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      keywords: ['transformers', 'attention'],
      researchArea: 'Natural Language Processing',
    });
    // The analysis is indexed as plain text, without the markdown headings.
    expect(pt.content).toContain('Our Visão geral text for attention-is-all-you-need (pt-BR).');
    expect(pt.content).not.toContain('##');
    const en = docs.find((d) => d.id === 'attention-is-all-you-need_en')!;
    expect(en.altTitle).toBeNull();
    expect(en.altKeywords).toEqual([]);
  });
});

describe('PapersSearch.rank', () => {
  it('asks nothing without MEILI_HOST, so the catalog keeps its plain match', async () => {
    delete process.env.MEILI_HOST;
    const { meili, search } = searchWith({});
    expect(await search.rank('attention', 'en')).toBeNull();
    search.onApplicationBootstrap();
    expect(meili.requests).toEqual([]);
    expect(meili.rebuilds).toEqual([]);
  });

  it('builds the papers index by words only, without an embedder', async () => {
    const { meili, search } = searchWith({ MEILI_HOST: 'http://meili.test' });
    await search.rebuild();
    expect(meili.rebuilds).toHaveLength(1);
    expect(meili.rebuilds[0].index).toBe('papers');
    expect(meili.rebuilds[0].settings).not.toHaveProperty('embedders');
    expect(meili.rebuilds[0].documents).toHaveLength(6);
  });

  it('searches the language asked, by every word, and answers slugs', async () => {
    const { meili, search } = searchWith({ MEILI_HOST: 'http://meili.test' });
    meili.answer = ['deep-residual-learning_pt-BR', 'attention-is-all-you-need_pt-BR'];
    expect(await search.rank('falhas em sistemas', 'pt-BR')).toEqual([
      'deep-residual-learning',
      'attention-is-all-you-need',
    ]);
    expect(meili.requests).toEqual([
      expect.objectContaining({
        index: 'papers',
        query: 'falhas em sistemas',
        filter: ['language = "pt-BR"'],
        matchingStrategy: 'all',
      }),
    ]);
    expect(meili.requests[0]).not.toHaveProperty('hybrid');
  });

  it('answers null when Meilisearch fails', async () => {
    const { meili, search } = searchWith({ MEILI_HOST: 'http://meili.test' });
    meili.answer = new Error('connection refused');
    expect(await search.rank('attention', 'en')).toBeNull();
  });
});

describe('the catalog with the index ranking', () => {
  it('lists what the index found, in its order, when no sort is asked', () => {
    // "residual" is not in the text of the attention paper; the index (by meaning, say) found it anyway.
    const page = catalog.list({ q: 'residual' }, ['attention-is-all-you-need', 'deep-residual-learning']);
    expect(slugs(page)).toEqual(['attention-is-all-you-need', 'deep-residual-learning']);
    expect(page.total).toBe(2);
  });

  it('lists only what the index found, even when the plain match would find more', () => {
    // "attention" is a keyword of both; the index answered one, and that is the search.
    expect(slugs(catalog.list({ q: 'attention' }, ['deep-residual-learning']))).toEqual(['deep-residual-learning']);
    expect(slugs(catalog.list({ q: 'attention' }, []))).toEqual([]);
  });

  it('still applies every other filter', () => {
    const ranked = ['zebra-finches-sing', 'attention-is-all-you-need'];
    expect(slugs(catalog.list({ q: 'x', type: 'preprint' }, ranked))).toEqual(['zebra-finches-sing']);
  });

  it('sorts by the date or the title when asked', () => {
    const ranked = ['zebra-finches-sing', 'deep-residual-learning', 'attention-is-all-you-need'];
    expect(slugs(catalog.list({ q: 'x', sort: 'recent' }, ranked))).toEqual([
      'zebra-finches-sing',
      'attention-is-all-you-need',
      'deep-residual-learning',
    ]);
    expect(slugs(catalog.list({ q: 'x', sort: 'title' }, ranked))).toEqual([
      'attention-is-all-you-need',
      'deep-residual-learning',
      'zebra-finches-sing',
    ]);
  });

  it('without the index, matches as before', () => {
    expect(slugs(catalog.list({ q: 'residual' }, null))).toEqual(['deep-residual-learning']);
    expect(slugs(catalog.list({ q: 'nothing-like-this' }, null))).toEqual([]);
  });
});
