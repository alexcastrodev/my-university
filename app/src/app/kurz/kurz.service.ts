import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { DiscussionService } from '../discussion/discussion.service';
import { DiscussionTopic } from '../discussion/discussion.model';
import {
  KurzAskResult,
  KurzBlockReason,
  KurzConversation,
  KurzError,
  KurzErrorKind,
  KurzScope,
  KurzStatus,
} from './kurz.model';

const API = '/api/kurz';
const BLOCK_REASONS: readonly string[] = [
  'PLATFORM_BUDGET_MONTHLY',
  'PLATFORM_BUDGET_DAILY',
  'USER_DAILY_LIMIT',
  'NO_BALANCE',
];

/** What an error response of `/api/kurz` means for the screen. Exported to be tested on its own. */
export function kurzErrorOf(error: unknown): KurzError {
  if (!(error instanceof HttpErrorResponse)) return { kind: 'failed', resetsAt: null };
  const body = (error.error ?? {}) as { code?: unknown; resetsAt?: unknown };
  const code = typeof body.code === 'string' ? body.code : '';
  const resetsAt = typeof body.resetsAt === 'string' ? body.resetsAt : null;
  const kind = ((): KurzErrorKind => {
    if (BLOCK_REASONS.includes(code)) return code as KurzBlockReason;
    switch (code) {
      case 'RATE_LIMITED':
        return 'rateLimited';
      case 'QUESTION_IN_PROGRESS':
        return 'inProgress';
      case 'AI_TERMS_REQUIRED':
        return 'terms';
      case 'KURZ_DISABLED':
        return 'disabled';
      case 'KURZ_UNAVAILABLE':
        return 'unavailable';
      case 'KURZ_BLOCKED':
        return 'blocked';
      case 'KURZ_UPSTREAM':
        return 'upstream';
      case 'KURZ_TIMEOUT':
        return 'timeout';
    }
    if (error.status === 401) return 'signIn';
    if (error.status === 403) return 'noAccess';
    if (error.status === 429) return 'rateLimited';
    return 'failed';
  })();
  return { kind, resetsAt };
}

/**
 * The Kurz, the assistant of the posts: what the student may do now (`status`), their conversations on
 * the page on screen, and the calls that ask, rate, report and publish. A conversation is private to the
 * student, so none of this is loaded for someone signed out.
 */
@Injectable({ providedIn: 'root' })
export class KurzService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private discussion = inject(DiscussionService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  status = signal<KurzStatus | null>(null);
  /** The student's conversations of the topic on screen. */
  conversations = signal<KurzConversation[]>([]);
  asking = signal(false);

  signedIn = computed(() => this.auth.currentUser() !== null);
  /** Unknown counts as on: someone signed out still sees the call to action, and signs in from it. */
  enabled = computed(() => this.status()?.enabled !== false);

  /** Brings the status and the conversations of the page up to date (nothing for someone signed out). */
  async refresh(): Promise<void> {
    if (!this.isBrowser) return;
    if (!this.signedIn()) {
      this.status.set(null);
      this.conversations.set([]);
      return;
    }
    await Promise.all([this.loadStatus(), this.loadConversations()]);
  }

  async loadStatus(): Promise<void> {
    if (!this.isBrowser || !this.signedIn()) return;
    try {
      this.status.set(await firstValueFrom(this.http.get<KurzStatus>(`${API}/status`)));
    } catch {
      // The Kurz is an extra: with no status the panel still opens, and says what failed when asked.
    }
  }

  async loadConversations(): Promise<void> {
    const topic = this.discussion.topic();
    if (!this.isBrowser || !this.signedIn() || !topic) {
      this.conversations.set([]);
      return;
    }
    try {
      const list = await firstValueFrom(
        this.http.get<KurzConversation[]>(`${API}/conversations`, { params: topicParams(topic) }),
      );
      if (this.discussion.topic() === topic) this.conversations.set(list);
    } catch {
      // Same as the status: a failed load just means no history.
    }
  }

  /** One question. On success the exchange is already in `conversations`. */
  async ask(
    question: string,
    scope: KurzScope,
    conversationId: string | null,
  ): Promise<{ ok: true; result: KurzAskResult } | { ok: false; error: KurzError }> {
    const topic = this.discussion.topic();
    if (!topic) return { ok: false, error: { kind: 'failed', resetsAt: null } };
    this.asking.set(true);
    try {
      const result = await firstValueFrom(
        this.http.post<KurzAskResult>(API, {
          ...topicParams(topic),
          question,
          ...(conversationId
            ? { conversationId }
            : {
                ...(scope.selection ? { selection: scope.selection } : {}),
                ...(scope.anchorKey !== null && scope.blockIndex !== null
                  ? { anchorKey: scope.anchorKey, blockIndex: scope.blockIndex }
                  : {}),
              }),
        }),
      );
      this.record(result, scope);
      void this.loadStatus();
      return { ok: true, result };
    } catch (error) {
      const kurzError = kurzErrorOf(error);
      // A blocked question changes what the panel says (no balance, budget spent): read it again.
      void this.loadStatus();
      return { ok: false, error: kurzError };
    } finally {
      this.asking.set(false);
    }
  }

  async acceptTerms(adult: boolean): Promise<boolean> {
    const version = this.status()?.termsVersion;
    if (!version) return false;
    try {
      await firstValueFrom(this.http.post(`${API}/terms`, { version, adult }));
      await this.loadStatus();
      return true;
    } catch {
      return false;
    }
  }

  async rate(messageId: string, helpful: boolean): Promise<boolean> {
    try {
      await firstValueFrom(this.http.put(`${API}/messages/${messageId}/feedback`, { helpful }));
      this.conversations.update((list) =>
        list.map((c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === messageId ? { ...m, helpful } : m)),
        })),
      );
      return true;
    } catch {
      return false;
    }
  }

  async report(messageId: string, note: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(
          `${API}/messages/${messageId}/report`,
          note.trim() ? { note: note.trim() } : {},
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Publishes the exchange in the discussion of the paragraph. The text is built by the server. */
  async share(messageId: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post(`${API}/messages/${messageId}/share`, {}));
      await this.discussion.refreshMarkers();
      return true;
    } catch {
      return false;
    }
  }

  /** Erases every conversation of the student (the profile's button). Returns how many, or null when it failed. */
  async deleteAll(): Promise<number | null> {
    try {
      const { deleted } = await firstValueFrom(
        this.http.delete<{ deleted: number }>(`${API}/conversations`),
      );
      this.conversations.set([]);
      return deleted;
    } catch {
      return null;
    }
  }

  async deleteOne(id: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.delete(`${API}/conversations/${id}`));
      this.conversations.update((list) => list.filter((c) => c.id !== id));
      return true;
    } catch {
      return false;
    }
  }

  private record(result: KurzAskResult, scope: KurzScope): void {
    this.conversations.update((list) => {
      const existing = list.find((c) => c.id === result.conversationId);
      if (existing) {
        return list.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                updatedAt: result.message.createdAt,
                messages: [...c.messages, result.message],
              }
            : c,
        );
      }
      return [
        ...list,
        {
          id: result.conversationId,
          anchorKey: scope.anchorKey,
          blockIndex: scope.blockIndex,
          selection: scope.selection,
          stale: false,
          updatedAt: result.message.createdAt,
          messages: [result.message],
        },
      ];
    });
  }
}

function topicParams(topic: DiscussionTopic): Record<string, string> {
  return {
    module: topic.module,
    slug: topic.slug,
    lang: topic.lang,
    ...(topic.discipline ? { discipline: topic.discipline } : {}),
  };
}
