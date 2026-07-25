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

  async configureIndex(): Promise<void> {
    await fetch(`${HOST}/indexes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ uid: INDEX, primaryKey: 'id' }),
    });

    await fetch(`${HOST}/indexes/${INDEX}/settings`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({
        searchableAttributes: ['title', 'subtitle', 'content'],
        filterableAttributes: ['type'],
        rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
      }),
    });
  }

  async replaceDocuments(documents: Record<string, unknown>[]): Promise<void> {
    await fetch(`${HOST}/indexes/${INDEX}/documents`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(documents),
    });
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
