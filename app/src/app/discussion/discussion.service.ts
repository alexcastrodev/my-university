import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { Location, isPlatformBrowser } from '@angular/common';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';
import { topicFromUrl } from './discussion-topic';
import {
  BlockAnchor,
  DiscussionTopic,
  MarkerDetail,
  MarkerSummary,
  PanelTarget,
} from './discussion.model';

const STORAGE_KEY = 'discussion-markers';
const API = '/api/discussions';
/** Query parameter that opens a discussion straight from a shared link. */
export const MARKER_PARAM = 'm';

export type DiscussionError = 'tooMany' | 'failed' | null;

/**
 * State and API calls for the paragraph discussions of the concept page on screen. The page's
 * DOM work (finding paragraphs, drawing markers) lives in DiscussionHost; this holds what the
 * markers and the panel need: the topic, the marker counts, the open discussion and its threads.
 */
@Injectable({ providedIn: 'root' })
export class DiscussionService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private location = inject(Location);
  private language = inject(LanguageService).language;
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  topic = signal<DiscussionTopic | null>(null);
  /** Markers on or off, remembered across pages. Defaults to on, like the mockups. */
  enabled = signal(this.readPreference());
  markers = signal<MarkerSummary[]>([]);
  target = signal<PanelTarget | null>(null);
  detail = signal<MarkerDetail | null>(null);
  busy = signal(false);
  error = signal<DiscussionError>(null);

  /** The current page has discussions at all (a concept page, not a list or a lesson). */
  available = computed(() => this.topic() !== null);
  markersVisible = computed(() => this.available() && this.enabled());
  panelOpen = computed(() => this.target() !== null);
  totalComments = computed(() => this.markers().reduce((sum, m) => sum + m.commentCount, 0));
  signedIn = computed(() => this.auth.currentUser() !== null);

  /** A marker from the shared link that has not been opened yet. */
  private pendingMarkerId: number | null = null;

  toggle(): void {
    const next = !this.enabled();
    this.enabled.set(next);
    if (!next) this.close();
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Private mode: the choice just doesn't outlive the tab.
    }
  }

  /** Called when the route changes: points the service at the concept the URL shows, or at nothing. */
  syncTopic(url: string): void {
    const parsed = topicFromUrl(url);
    const next = parsed ? { ...parsed, lang: this.language } : null;
    const current = this.topic();
    if (JSON.stringify(next) === JSON.stringify(current)) return;

    this.reset();
    this.topic.set(next);
    if (!next) return;
    this.pendingMarkerId = this.readMarkerParam(url);
    void this.refreshMarkers();
  }

  reset(): void {
    this.topic.set(null);
    this.markers.set([]);
    this.target.set(null);
    this.detail.set(null);
    this.error.set(null);
    this.pendingMarkerId = null;
  }

  async refreshMarkers(): Promise<void> {
    const topic = this.topic();
    if (!topic) return;
    try {
      const markers = await firstValueFrom(
        this.http.get<MarkerSummary[]>(API, { params: this.topicParams(topic) }),
      );
      if (this.topic() !== topic) return; // the reader moved on while this was in flight
      this.markers.set(markers);
      this.openPendingMarker();
    } catch {
      // Discussions are an extra: a failed load just means no badges.
    }
  }

  /** Opens the discussion of a paragraph the reader clicked. */
  openBlock(block: BlockAnchor, marker: MarkerSummary | null): void {
    this.error.set(null);
    this.target.set({ markerId: marker?.id ?? null, block, quote: marker?.quote ?? block.quote, reveal: false });
    this.afterTargetChange(marker?.id ?? null);
  }

  /** Opens a discussion from the "other paragraphs" list or a shared link. */
  openMarker(marker: MarkerSummary, block: BlockAnchor | null = null): void {
    this.error.set(null);
    this.target.set({ markerId: marker.id, block, quote: marker.quote, reveal: true });
    this.afterTargetChange(marker.id);
  }

  /** A discussion opened from a link or the list does not know its paragraph yet; the host fills it in. */
  attachBlock(block: BlockAnchor): void {
    const target = this.target();
    if (target && !target.block) this.target.set({ ...target, block });
  }

  close(): void {
    this.target.set(null);
    this.detail.set(null);
    this.error.set(null);
    this.writeMarkerParam(null);
  }

  /** Starts a new thread, or answers an existing one when `parentId` is given. */
  async submit(body: string, parentId: number | null): Promise<boolean> {
    const target = this.target();
    const topic = this.topic();
    if (!target || !topic) return false;

    return this.run(async () => {
      if (parentId !== null && target.markerId !== null) {
        await firstValueFrom(
          this.http.post(`${API}/markers/${target.markerId}/comments`, { parentId, body }),
        );
      } else if (target.block) {
        const created = await firstValueFrom(
          this.http.post<{ markerId: number; commentId: number }>(`${API}/threads`, {
            module: topic.module,
            slug: topic.slug,
            ...(topic.discipline ? { discipline: topic.discipline } : {}),
            lang: topic.lang,
            anchorKey: target.block.key,
            blockIndex: target.block.index,
            quote: target.block.quote,
            body,
          }),
        );
        this.target.set({ ...target, markerId: created.markerId });
        this.writeMarkerParam(created.markerId);
      } else {
        return;
      }
      await Promise.all([this.reloadDetail(), this.refreshMarkers()]);
    });
  }

  vote(commentId: number, voted: boolean): Promise<boolean> {
    return this.mutate(
      voted
        ? this.http.delete(`${API}/comments/${commentId}/vote`)
        : this.http.put(`${API}/comments/${commentId}/vote`, {}),
    );
  }

  accept(rootId: number, replyId: number): Promise<boolean> {
    return this.mutate(this.http.put(`${API}/comments/${rootId}/accept`, { replyId }));
  }

  unaccept(rootId: number): Promise<boolean> {
    return this.mutate(this.http.delete(`${API}/comments/${rootId}/accept`));
  }

  remove(commentId: number): Promise<boolean> {
    return this.mutate(this.http.delete(`${API}/comments/${commentId}`));
  }

  private mutate(request: Observable<unknown>): Promise<boolean> {
    return this.run(async () => {
      await firstValueFrom(request);
      await Promise.all([this.reloadDetail(), this.refreshMarkers()]);
    });
  }

  private async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      return true;
    } catch (e) {
      this.error.set(e instanceof HttpErrorResponse && e.status === 429 ? 'tooMany' : 'failed');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private afterTargetChange(markerId: number | null): void {
    this.detail.set(null);
    this.writeMarkerParam(markerId);
    if (markerId !== null) void this.reloadDetail();
  }

  private async reloadDetail(): Promise<void> {
    const markerId = this.target()?.markerId;
    if (markerId === null || markerId === undefined) return;
    const detail = await firstValueFrom(this.http.get<MarkerDetail>(`${API}/markers/${markerId}`));
    if (this.target()?.markerId === markerId) this.detail.set(detail);
  }

  private openPendingMarker(): void {
    if (this.pendingMarkerId === null) return;
    const marker = this.markers().find((m) => m.id === this.pendingMarkerId);
    this.pendingMarkerId = null;
    if (marker) this.openMarker(marker);
  }

  private topicParams(topic: DiscussionTopic): Record<string, string> {
    return {
      module: topic.module,
      slug: topic.slug,
      lang: topic.lang,
      ...(topic.discipline ? { discipline: topic.discipline } : {}),
    };
  }

  private readMarkerParam(url: string): number | null {
    const raw = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '').get(MARKER_PARAM);
    const id = raw ? Number(raw) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  /** Keeps `?m=<id>` in the address bar while a discussion is open, so the URL can be shared. */
  private writeMarkerParam(markerId: number | null): void {
    if (!this.isBrowser) return;
    const query = new URLSearchParams(window.location.search);
    if (markerId === null) query.delete(MARKER_PARAM);
    else query.set(MARKER_PARAM, String(markerId));
    const [path] = this.location.path().split(/[?#]/);
    this.location.replaceState(path, query.toString());
  }

  private readPreference(): boolean {
    if (!this.isBrowser) return true;
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }
}
