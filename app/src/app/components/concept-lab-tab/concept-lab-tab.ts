import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { LanguageService } from '../../services/language.service';
import { CommentView, MarkerDetail, ThreadView } from '../../discussion/discussion.model';
import { timeAgo } from '../../discussion/time-ago';

const API = '/api/discussions';
const MAX_BODY = 2000;
const QUOTE_CHARS = 220;

/**
 * The "Lab" tab of a concept: the call to action, the lab's summary and the students' discussion.
 * The discussion is one flat list of posts (a thread each, replies underneath, quoting the post
 * they answer) on a single marker per concept and language, so votes, deletes and replies reuse
 * the paragraph-discussion endpoints.
 */
@Component({
  selector: 'app-concept-lab-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './concept-lab-tab.html',
  styleUrl: './concept-lab-tab.css',
})
export class ConceptLabTab {
  labUrl = input.required<string>();
  labHtml = input<SafeHtml | null>(null);
  module = input.required<string>();
  slug = input.required<string>();

  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private lang = inject(LanguageService).language;
  private locale = inject(LOCALE_ID);

  protected readonly maxBody = MAX_BODY;
  protected signedIn = computed(() => this.auth.currentUser() !== null);
  protected detail = signal<MarkerDetail | null>(null);
  protected busy = signal(false);
  protected failed = signal(false);
  protected draft = signal('');
  protected replyingTo = signal<number | null>(null);
  protected replyDraft = signal('');
  protected confirmingDelete = signal<number | null>(null);

  protected threads = computed<ThreadView[]>(() => this.detail()?.threads ?? []);
  protected count = computed(() => this.detail()?.commentCount ?? 0);

  constructor() {
    effect(() => {
      this.slug();
      void this.reload();
    });
  }

  protected canSend(text: string): boolean {
    return text.trim().length > 0 && text.length <= MAX_BODY && !this.busy();
  }

  protected async post(): Promise<void> {
    const body = this.draft().trim();
    if (!this.canSend(body)) return;
    const ok = await this.run(() =>
      firstValueFrom(this.http.post(`${API}/lab`, { ...this.topic(), body })),
    );
    if (ok) this.draft.set('');
  }

  protected async reply(thread: ThreadView): Promise<void> {
    const body = this.replyDraft().trim();
    const markerId = this.detail()?.id;
    if (!this.canSend(body) || !markerId) return;
    const ok = await this.run(() =>
      firstValueFrom(
        this.http.post(`${API}/markers/${markerId}/comments`, { parentId: thread.root.id, body }),
      ),
    );
    if (ok) {
      this.replyDraft.set('');
      this.replyingTo.set(null);
    }
  }

  protected vote(comment: CommentView): void {
    const url = `${API}/comments/${comment.id}/vote`;
    void this.run(() =>
      firstValueFrom(comment.votedByMe ? this.http.delete(url) : this.http.put(url, {})),
    );
  }

  protected async remove(comment: CommentView): Promise<void> {
    if (this.confirmingDelete() !== comment.id) {
      this.confirmingDelete.set(comment.id);
      return;
    }
    this.confirmingDelete.set(null);
    await this.run(() => firstValueFrom(this.http.delete(`${API}/comments/${comment.id}`)));
  }

  protected toggleReply(thread: ThreadView): void {
    this.replyDraft.set('');
    this.replyingTo.set(this.replyingTo() === thread.root.id ? null : thread.root.id);
  }

  protected onInput(signalRef: { set(v: string): void }, event: Event): void {
    signalRef.set((event.target as HTMLTextAreaElement).value);
  }

  protected name(comment: CommentView): string {
    return comment.author?.displayName ?? '';
  }

  protected initials(comment: CommentView): string {
    return this.name(comment)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }

  protected ago(iso: string): string {
    return timeAgo(iso, this.locale);
  }

  protected excerpt(comment: CommentView): string {
    const text = comment.deleted ? '' : comment.body;
    return text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}...` : text;
  }

  private topic() {
    return { module: this.module(), slug: this.slug(), lang: this.lang };
  }

  private async reload(): Promise<void> {
    try {
      const detail = await firstValueFrom(
        this.http.get<MarkerDetail>(`${API}/lab`, { params: this.topic() }),
      );
      this.detail.set(detail);
    } catch {
      // The discussion is an extra: the lab link and summary work without it.
      this.detail.set({ id: 0, quote: '', commentCount: 0, threads: [] });
    }
  }

  private async run(action: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.failed.set(false);
    try {
      await action();
      await this.reload();
      return true;
    } catch {
      this.failed.set(true);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
