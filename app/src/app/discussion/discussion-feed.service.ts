import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';
import { FeedArea, FeedItem, FeedPage, FeedScope } from './discussion.model';

const API = '/api/discussions/feed';

/**
 * State of the Discussions page: the markers of every concept, most recent activity first,
 * filtered by scope and area in the reader's language, loaded a cursor page at a time.
 * Provided by the page, so each visit starts fresh.
 */
@Injectable()
export class DiscussionFeedService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private lang = inject(LanguageService).language;

  scope = signal<FeedScope>('all');
  area = signal<string | null>(null);
  items = signal<FeedItem[]>([]);
  areas = signal<FeedArea[]>([]);
  nextCursor = signal<string | null>(null);
  loading = signal(false);
  loadingMore = signal(false);
  error = signal(false);

  /** "Mine" and "Participated" only exist for a signed-in reader. */
  needsLogin = computed(() => this.scope() !== 'all' && !this.auth.currentUser());
  hasMore = computed(() => this.nextCursor() !== null);

  /** Bumped by every new first-page load, so a late answer for old filters is dropped. */
  private generation = 0;
  private areasGeneration = 0;

  /** Loads the first page for the current scope and area. */
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.items.set([]);
    this.nextCursor.set(null);
    this.error.set(false);
    this.loadingMore.set(false);
    if (this.needsLogin()) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const page = await this.fetch(null);
      if (generation !== this.generation) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
    } catch {
      if (generation === this.generation) this.error.set(true);
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  /** Appends the page after the last one shown. */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const generation = this.generation;
    this.loadingMore.set(true);
    this.error.set(false);
    try {
      const page = await this.fetch(cursor);
      if (generation !== this.generation) return;
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch {
      if (generation === this.generation) this.error.set(true);
    } finally {
      if (generation === this.generation) this.loadingMore.set(false);
    }
  }

  /** Counts per area for the chips, under the current scope (never the area itself). */
  async loadAreas(): Promise<void> {
    const generation = ++this.areasGeneration;
    if (this.needsLogin()) {
      this.areas.set([]);
      return;
    }
    try {
      const areas = await firstValueFrom(
        this.http.get<FeedArea[]>(`${API}/areas`, {
          params: { scope: this.scope(), lang: this.lang },
        }),
      );
      if (generation === this.areasGeneration) this.areas.set(areas);
    } catch {
      // The chips are a shortcut; the list still works without them.
      if (generation === this.areasGeneration) this.areas.set([]);
    }
  }

  private fetch(cursor: string | null): Promise<FeedPage> {
    const area = this.area();
    return firstValueFrom(
      this.http.get<FeedPage>(API, {
        params: {
          scope: this.scope(),
          lang: this.lang,
          ...(area ? { area } : {}),
          ...(cursor ? { cursor } : {}),
        },
      }),
    );
  }
}
