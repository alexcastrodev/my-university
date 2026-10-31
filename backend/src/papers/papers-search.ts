import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MeilisearchClient } from '../search/meilisearch.client';
import { Language } from '../shared/language';
import { PapersCatalogService } from './papers-catalog.service';

const INDEX = 'papers';
const EMBEDDER = 'default';
/** Computing the embeddings of every paper (and, the first time, downloading a local model) takes minutes. */
const SEMANTIC_TASK_TIMEOUT_MS = 15 * 60_000;
/** More than the catalog will hold for a long while; the ranking is cut here. */
const MAX_HITS = 1000;

/**
 * Words a search ignores, so "falhas em sistemas distribuídos" asks for the three words that mean something.
 * Every other word of the query must be in the paper (`matchingStrategy: 'all'`), the same AND as the filters.
 */
const STOP_WORDS = [
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'of', 'on',
  'or', 'the', 'to', 'with',
  // Portuguese
  'à', 'às', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no',
  'nos', 'num', 'numa', 'o', 'os', 'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'que', 'um', 'uma',
];

const SETTINGS = {
  // Order is priority for the `attribute` ranking rule: the title and the keywords beat the analysis.
  searchableAttributes: [
    'title',
    'altTitle',
    'keywords',
    'altKeywords',
    'researchArea',
    'altResearchArea',
    'authors',
    'doi',
    'summary',
    'abstract',
    'altAbstract',
    'content',
  ],
  filterableAttributes: ['language'],
  displayedAttributes: ['id', 'slug', 'language'],
  stopWords: STOP_WORDS,
  pagination: { maxTotalHits: MAX_HITS },
};

/** What the embedder reads of a paper: what it is about, not the whole analysis. */
const DOCUMENT_TEMPLATE = [
  '{{ doc.title }}',
  '{% if doc.altTitle %}{{ doc.altTitle }}{% endif %}',
  '{% if doc.researchArea %}{{ doc.researchArea }}{% endif %}',
  "{{ doc.keywords | join: ', ' }}",
  '{% if doc.summary %}{{ doc.summary }}{% endif %}',
  '{% if doc.abstract %}{{ doc.abstract }}{% endif %}',
].join('\n');

/**
 * The embedder of `MEILI_PAPERS_EMBEDDER`: a Meilisearch embedder object as JSON, for example
 * `{"source":"huggingFace","model":"sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"}` (a model
 * that runs inside Meilisearch, no key), or `{"source":"openAi","apiKey":"...","model":"text-embedding-3-small"}`.
 * Unset, the search is by words only. A template of our own is used when the object brings none.
 */
function embedderFromEnv(): Record<string, unknown> | null {
  const raw = process.env.MEILI_PAPERS_EMBEDDER?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return { documentTemplate: DOCUMENT_TEMPLATE, documentTemplateMaxBytes: 2000, ...parsed };
  } catch (err) {
    new Logger('PapersSearch').error(
      `MEILI_PAPERS_EMBEDDER is not a JSON object (${(err as Error).message}); searching by words only`,
    );
    return null;
  }
}

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
};

/**
 * The search of the public papers in Meilisearch: accents and letter case do not matter, a typo is forgiven,
 * a word matches in either language, and the papers come best first. With an embedder (see `embedderFromEnv`)
 * it is also semantic: "falhas em sistemas distribuídos" finds "Metastable Failures" by meaning.
 *
 * Only with `MEILI_HOST` set (the Docker stack). Without it, or when Meilisearch fails, `rank` answers null
 * and the catalog falls back to its plain match (papers-filter.ts), so a search never breaks the list.
 * The index is rebuilt on boot from the files, like the site-wide one (search.service.ts).
 */
@Injectable()
export class PapersSearch implements OnApplicationBootstrap {
  private readonly log = new Logger(PapersSearch.name);
  private readonly enabled = !!process.env.MEILI_HOST;
  private readonly embedder = embedderFromEnv();
  private readonly semanticRatio = numberFromEnv('MEILI_PAPERS_SEMANTIC_RATIO', 0.5);
  private readonly minScore = numberFromEnv('MEILI_PAPERS_MIN_SCORE', 0.5);
  /** Whether the live index has the embedder; false until a rebuild with it succeeds. */
  private semantic = false;

  constructor(
    @Inject(PapersCatalogService) private readonly catalog: PapersCatalogService,
    @Inject(MeilisearchClient) private readonly meili: MeilisearchClient,
  ) {}

  onApplicationBootstrap() {
    if (this.enabled) void this.rebuildOnBoot();
  }

  private rebuildOnBoot(): Promise<void> {
    return Sentry.startSpan({ name: 'papers search index rebuild', op: 'task', forceTransaction: true }, async () => {
      try {
        await this.meili.waitUntilHealthy();
        await this.rebuild();
      } catch (err) {
        this.log.error(`Failed to build the papers search index: ${(err as Error).message}`);
      }
    });
  }

  /** With the embedder when there is one; when that build fails (a model that does not load, a bad key), without. */
  async rebuild(): Promise<void> {
    const documents = this.catalog.searchDocuments();
    if (this.embedder) {
      try {
        await this.meili.rebuild({
          index: INDEX,
          settings: { ...SETTINGS, embedders: { [EMBEDDER]: this.embedder } },
          documents,
          taskTimeoutMs: SEMANTIC_TASK_TIMEOUT_MS,
        });
        this.semantic = true;
        return;
      } catch (err) {
        Sentry.captureException(err);
        this.log.error(
          `The papers index could not be built with the embedder, searching by words only: ${(err as Error).message}`,
        );
      }
    }
    this.semantic = false;
    await this.meili.rebuild({ index: INDEX, settings: SETTINGS, documents });
  }

  /** The slugs of the papers that match `q` in this language, best first; null when there is no index to ask. */
  async rank(q: string, lang: Language): Promise<string[] | null> {
    if (!this.enabled || !q.trim()) return null;
    try {
      const ids = await this.meili.matchingIds({
        index: INDEX,
        query: q,
        filter: [`language = "${lang}"`],
        limit: MAX_HITS,
        matchingStrategy: 'all',
        ...(this.semantic && {
          hybrid: { embedder: EMBEDDER, semanticRatio: this.semanticRatio },
          rankingScoreThreshold: this.minScore,
        }),
      });
      return ids.map((id) => id.slice(0, -`_${lang}`.length));
    } catch (err) {
      this.log.warn(`Papers search fell back to the plain match: ${(err as Error).message}`);
      return null;
    }
  }
}
