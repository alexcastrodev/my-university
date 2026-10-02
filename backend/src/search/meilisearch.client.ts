import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

const HOST = process.env.MEILI_HOST ?? 'http://127.0.0.1:7700';
const API_KEY = process.env.MEILI_MASTER_KEY;
const INDEX = 'content';
/** Holds one document: the fingerprint of what `INDEX` was last built from. */
const META_INDEX = 'content_meta';
const META_DOC_ID = 'content';

/** Words of body text Meilisearch keeps around the best match for a result's snippet. */
const SNIPPET_WORDS = 24;

const INDEX_SETTINGS = {
  // Order is priority for the `attribute` ranking rule: a title match beats a body match.
  searchableAttributes: ['title', 'altTitle', 'summary', 'subtitle', 'content'],
  filterableAttributes: ['type', 'visibleIn'],
  displayedAttributes: [
    'id',
    'type',
    'title',
    'subtitle',
    'url',
    'summary',
    'content',
    'language',
  ],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness',
  ],
  faceting: { maxValuesPerFacet: 100 },
  pagination: { maxTotalHits: 1000 },
};

/** One indexed page, in one language. */
export interface SearchDocument {
  id: string;
  type: string;
  title: string;
  /** The original (English) title on a translated document, so searching it still finds the translation. */
  altTitle: string;
  subtitle: string | null;
  url: string;
  summary: string;
  content: string;
  language: string;
  /** Languages whose searches see this document (see SearchService.buildContentDocuments). */
  visibleIn: string[];
}

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  url: string;
  language: string;
  highlightedTitle: string;
  snippet: string | null;
}

export interface SearchRequest {
  query: string;
  /** Applied to the hits (AND of every expression). */
  filter: string[];
  /** Applied to the facet counts only, so a type filter doesn't hide the other types' counts. */
  facetFilter: string[];
  limit: number;
  offset: number;
  highlightPreTag: string;
  highlightPostTag: string;
}

export interface SearchPage {
  hits: SearchHit[];
  total: number;
  facets: Record<string, number>;
}

interface RawHit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  url: string;
  language?: string;
  _formatted?: { title?: string; summary?: string; content?: string };
}

interface MeiliMultiSearchResponse {
  results: {
    hits: RawHit[];
    estimatedTotalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  }[];
}

@Injectable()
export class MeilisearchClient {
  private readonly log = new Logger(MeilisearchClient.name);

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
    return headers;
  }

  async waitUntilHealthy(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${HOST}/health`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Meilisearch did not become healthy within ${timeoutMs}ms`);
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${HOST}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Meilisearch ${method} ${path} failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Every Meilisearch write is an async task; this blocks until it finishes and surfaces a failure instead of dropping it. */
  private async waitForTask(
    taskUid: number,
    timeoutMs = 120_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await this.request<{
        status: string;
        error?: { message: string };
      }>('GET', `/tasks/${taskUid}`);
      if (task.status === 'succeeded') return;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new Error(
          `Meilisearch task ${taskUid} ${task.status}: ${task.error?.message ?? 'unknown error'}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `Meilisearch task ${taskUid} did not finish within ${timeoutMs}ms`,
    );
  }

  private async enqueue(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<void> {
    const { taskUid } = await this.request<{ taskUid: number }>(
      method,
      path,
      body,
    );
    await this.waitForTask(taskUid);
  }

  /** Creates the index, tolerating "already exists" (the create task itself fails with `index_already_exists`). */
  private async ensureIndex(uid: string): Promise<void> {
    try {
      await this.enqueue('POST', '/indexes', { uid, primaryKey: 'id' });
    } catch (err) {
      if (
        !(err as Error).message.includes('index_already_exists') &&
        !(err as Error).message.includes('already exists')
      ) {
        throw err;
      }
    }
  }

  /**
   * Rebuilds the whole index from `documents`. Adding documents to the live index only ever
   * adds or updates, so a concept that was removed or renamed would stay searchable forever;
   * instead everything goes into a fresh index that is then atomically swapped in, so search
   * keeps answering from the old index until the new one is complete.
   */
  async rebuildIndex(documents: SearchDocument[]): Promise<void> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ settings: INDEX_SETTINGS, documents }))
      .digest('hex');
    if (await this.isCurrent(fingerprint, documents.length)) {
      this.log.log(
        `Search index already matches the content (${documents.length} documents), skipping rebuild`,
      );
      return;
    }

    const staging = `${INDEX}_staging_${Date.now()}`;
    await this.ensureIndex(INDEX);
    await this.ensureIndex(staging);
    try {
      await this.enqueue(
        'PATCH',
        `/indexes/${staging}/settings`,
        INDEX_SETTINGS,
      );
      await this.enqueue('PUT', `/indexes/${staging}/documents`, documents);
      await this.enqueue('POST', '/swap-indexes', [
        { indexes: [INDEX, staging] },
      ]);
    } finally {
      // After a successful swap this holds the previous generation; after a failure, the partial build.
      await this.enqueue('DELETE', `/indexes/${staging}`).catch((err: Error) =>
        this.log.warn(`Could not delete ${staging}: ${err.message}`),
      );
    }
    await this.ensureIndex(META_INDEX);
    await this.enqueue('PUT', `/indexes/${META_INDEX}/documents`, [
      { id: META_DOC_ID, fingerprint },
    ]);
    this.log.log(`Indexed ${documents.length} documents into Meilisearch`);
  }

  /**
   * Every API replica rebuilds on boot, and most deploys don't touch content, so a rebuild is
   * skipped when the live index was built from exactly these documents and settings. The
   * document count is checked too, as a guard against an index emptied or replaced outside the app.
   */
  private async isCurrent(
    fingerprint: string,
    documentCount: number,
  ): Promise<boolean> {
    try {
      const meta = await this.request<{ fingerprint?: string }>(
        'GET',
        `/indexes/${META_INDEX}/documents/${META_DOC_ID}`,
      );
      if (meta.fingerprint !== fingerprint) return false;
      const stats = await this.request<{ numberOfDocuments: number }>(
        'GET',
        `/indexes/${INDEX}/stats`,
      );
      return stats.numberOfDocuments === documentCount;
    } catch {
      return false; // no meta index/document yet (first run), or Meilisearch hiccup: just rebuild
    }
  }

  /**
   * One round trip, two queries: the page of hits for the active filter, and the per-type counts
   * for the same text without the type filter (otherwise picking a type would zero every other
   * pill's count).
   */
  async search(req: SearchRequest): Promise<SearchPage> {
    const highlight = {
      attributesToHighlight: ['title', 'summary', 'content'],
      attributesToCrop: ['summary', 'content'],
      cropLength: SNIPPET_WORDS,
      highlightPreTag: req.highlightPreTag,
      highlightPostTag: req.highlightPostTag,
    };
    const data = await this.request<MeiliMultiSearchResponse>(
      'POST',
      '/multi-search',
      {
        queries: [
          {
            indexUid: INDEX,
            q: req.query,
            filter: req.filter,
            limit: req.limit,
            offset: req.offset,
            attributesToRetrieve: [
              'id',
              'type',
              'title',
              'subtitle',
              'url',
              'language',
            ],
            ...highlight,
          },
          {
            indexUid: INDEX,
            q: req.query,
            filter: req.facetFilter,
            limit: 0,
            facets: ['type'],
          },
        ],
      },
    );
    const [page, counts] = data.results;

    const hasMatch = (text: string | undefined): text is string =>
      !!text && text.includes(req.highlightPreTag);

    return {
      total: page.estimatedTotalHits ?? page.hits.length,
      facets: counts.facetDistribution?.type ?? {},
      hits: page.hits.map((hit) => {
        const formatted = hit._formatted ?? {};
        // Prefer the summary when it holds a match: it's written to be read on its own.
        const snippet = hasMatch(formatted.summary)
          ? formatted.summary
          : hasMatch(formatted.content)
            ? formatted.content
            : null;
        return {
          id: hit.id,
          type: hit.type,
          title: hit.title,
          subtitle: hit.subtitle,
          url: hit.url,
          language: hit.language ?? 'en',
          highlightedTitle: formatted.title ?? hit.title,
          snippet,
        };
      }),
    };
  }
}
