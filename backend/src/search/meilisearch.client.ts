import { Injectable, Logger } from '@nestjs/common';

const HOST = process.env.MEILI_HOST ?? 'http://127.0.0.1:7700';
const API_KEY = process.env.MEILI_MASTER_KEY;
const INDEX = 'content';

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  url: string;
}

interface MeiliSearchResponse {
  hits: SearchHit[];
}

@Injectable()
export class MeilisearchClient {
  private readonly log = new Logger(MeilisearchClient.name);

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${HOST}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Meilisearch ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /** Every Meilisearch write is an async task; this blocks until it finishes and surfaces a failure instead of dropping it. */
  private async waitForTask(taskUid: number, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await this.request<{ status: string; error?: { message: string } }>('GET', `/tasks/${taskUid}`);
      if (task.status === 'succeeded') return;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new Error(`Meilisearch task ${taskUid} ${task.status}: ${task.error?.message ?? 'unknown error'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Meilisearch task ${taskUid} did not finish within ${timeoutMs}ms`);
  }

  private async enqueue(method: string, path: string, body?: unknown): Promise<void> {
    const { taskUid } = await this.request<{ taskUid: number }>(method, path, body);
    await this.waitForTask(taskUid);
  }

  /** Creates the index, tolerating "already exists" (the create task itself fails with `index_already_exists`). */
  private async ensureIndex(uid: string): Promise<void> {
    try {
      await this.enqueue('POST', '/indexes', { uid, primaryKey: 'id' });
    } catch (err) {
      if (!(err as Error).message.includes('index_already_exists') && !(err as Error).message.includes('already exists')) {
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
  async rebuildIndex(documents: Record<string, unknown>[]): Promise<void> {
    const staging = `${INDEX}_staging_${Date.now()}`;
    await this.ensureIndex(INDEX);
    await this.ensureIndex(staging);
    try {
      await this.enqueue('PATCH', `/indexes/${staging}/settings`, {
        searchableAttributes: ['title', 'subtitle', 'content'],
        filterableAttributes: ['type'],
        rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
      });
      await this.enqueue('PUT', `/indexes/${staging}/documents`, documents);
      await this.enqueue('POST', '/swap-indexes', [{ indexes: [INDEX, staging] }]);
    } finally {
      // After a successful swap this holds the previous generation; after a failure, the partial build.
      await this.enqueue('DELETE', `/indexes/${staging}`).catch((err: Error) =>
        this.log.warn(`Could not delete ${staging}: ${err.message}`),
      );
    }
    this.log.log(`Indexed ${documents.length} documents into Meilisearch`);
  }

  async search(query: string, filter?: string, limit = 20): Promise<SearchHit[]> {
    const res = await fetch(`${HOST}/indexes/${INDEX}/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        q: query,
        filter,
        limit,
        attributesToRetrieve: ['id', 'type', 'title', 'subtitle', 'url'],
      }),
    });
    if (!res.ok) {
      throw new Error(`Meilisearch search failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as MeiliSearchResponse;
    return data.hits;
  }
}
