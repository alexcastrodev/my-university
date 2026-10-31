import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { MeilisearchClient } from '../search/meilisearch.client';
import { Language } from '../shared/language';
import { PapersCatalogService } from './papers-catalog.service';

const INDEX = 'papers';
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

/**
 * The search of the public papers in Meilisearch: accents and letter case do not matter, a typo is forgiven,
 * a word matches in either language, and the papers come best first. By words only: no embedder, no hybrid.
 *
 * Only with `MEILI_HOST` set (the Docker stack). Without it, or when Meilisearch fails, `rank` answers null
 * and the catalog falls back to its plain match (paper-filter.ts), so a search never breaks the list.
 * The index is rebuilt on boot from the files, like the site-wide one (search.service.ts).
 */
@Injectable()
export class PapersSearch implements OnApplicationBootstrap {
  private readonly log = new Logger(PapersSearch.name);
  private readonly enabled = !!process.env.MEILI_HOST;

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

  async rebuild(): Promise<void> {
    await this.meili.rebuild({ index: INDEX, settings: SETTINGS, documents: this.catalog.searchDocuments() });
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
      });
      return ids.map((id) => id.slice(0, -`_${lang}`.length));
    } catch (err) {
      this.log.warn(`Papers search fell back to the plain match: ${(err as Error).message}`);
      return null;
    }
  }
}
