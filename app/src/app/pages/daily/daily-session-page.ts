import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { DailySessionService } from '../../services/daily-session.service';
import {
  DailyCard,
  DailySession,
  NoticeCard,
  ReadCard,
  RecallCard,
  WriteCard,
} from '../../models/daily.model';

type Phase = 'card' | 'done';
type RecallAnswer = 'remembered' | 'forgot' | null;

/** Card prose is a real excerpt of a concept's markdown, which routinely uses backtick
 *  spans for identifiers (`WeakHashMap`) — rendering it as plain text leaves the
 *  backticks visible. This renders only that one inline construct, not full markdown, to
 *  avoid pulling in the heavy shared concept pipeline (mermaid/wiki-links/deep-dives)
 *  for what is a 1-2 paragraph excerpt. Escaped first, so no other markup can slip in. */
function renderInlineCode(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * The full-screen card runner (mockups tmp/mobile/, screens 02–06):
 * a segmented progress bar, a close button, one card at a time
 * (recall / read / notice / write), then the session-done summary.
 *
 * A session can legitimately have fewer than 4 cards, or zero (see
 * `daily.model.ts`) — the empty state is handled explicitly below rather
 * than assuming a card always exists.
 *
 * Recall is self-rating (no real MCQ — see `daily.model.ts`): "I remember"
 * posts SM2 rating `good`, "I do not remember" posts `again`, both via
 * `DailySessionService.complete`, which also grants XP for every card type
 * as the user finishes it.
 */
@Component({
  selector: 'app-daily-session-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './daily-session-page.html',
  styleUrl: './daily-session-page.css',
})
export class DailySessionPage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  private dailyService = inject(DailySessionService);
  private router = inject(Router);

  protected readonly session = signal<DailySession | null>(null);
  protected readonly index = signal(0);
  protected readonly phase = signal<Phase>('card');

  // Recall per-card state
  protected readonly recallAnswered = signal<RecallAnswer>(null);

  // Read/Notice per-card state — guards against double-firing the completion POST on repeat "Next" clicks.
  private readonly completedSourceIds = new Set<string>();

  // Write per-card state
  protected readonly writeText = signal('');
  protected readonly writeSaved = signal(false);

  protected readonly cards = computed<DailyCard[]>(() => this.session()?.cards ?? []);
  protected readonly total = computed(() => this.cards().length);
  protected readonly current = computed<DailyCard | null>(() => this.cards()[this.index()] ?? null);
  protected readonly isLast = computed(() => this.index() >= this.total() - 1);
  protected readonly totalXp = computed(() =>
    this.cards().reduce((sum, card) => sum + card.xp, 0),
  );
  protected readonly segments = computed(() =>
    Array.from({ length: this.total() }, (_, i) => i <= this.index()),
  );

  ngOnInit(): void {
    this.dailyService.build().subscribe((session) => this.session.set(session));

    if (this.auth.currentUser()) {
      this.xpService.loadSummary();
      this.xpService.loadStreak();
    }
  }

  // Typed accessors — keep the template type-safe over the discriminated union.
  asRecall(card: DailyCard): RecallCard {
    return card as RecallCard;
  }
  asRead(card: DailyCard): ReadCard {
    return card as ReadCard;
  }
  asNotice(card: DailyCard): NoticeCard {
    return card as NoticeCard;
  }
  asWrite(card: DailyCard): WriteCard {
    return card as WriteCard;
  }

  paragraphs(body: string): string[] {
    return body.split('\n\n');
  }

  inline(text: string): string {
    return renderInlineCode(text);
  }

  answerRecall(remembered: boolean): void {
    if (this.recallAnswered() !== null) return;
    const card = this.asRecall(this.current()!);
    this.recallAnswered.set(remembered ? 'remembered' : 'forgot');

    if (this.auth.currentUser()) {
      this.dailyService
        .complete('recall', card.sourceId, {
          sourceType: card.sourceType,
          rating: remembered ? 'good' : 'again',
        })
        .subscribe({ next: () => this.refreshXp(), error: () => {} });
    }
  }

  /** Fires the completion POST for Read/Notice at most once per card (a "Next" click can't
   *  double-grant XP even if pressed more than once before navigation). Keyed by
   *  `type:sourceId`, not bare `sourceId` — Notice falls back to reusing Read's own
   *  concept when no second source is available (`DailyService.pickNoticeEntry`), so the
   *  two cards can legitimately share a sourceId and must still be tracked separately or
   *  Notice's completion is wrongly seen as a repeat of Read's and silently dropped. */
  markSeen(card: ReadCard | NoticeCard): void {
    const key = `${card.type}:${card.sourceId}`;
    if (!this.auth.currentUser() || this.completedSourceIds.has(key)) return;
    this.completedSourceIds.add(key);
    this.dailyService
      .complete(card.type, card.sourceId)
      .subscribe({ next: () => this.refreshXp(), error: () => {} });
  }

  onWriteInput(event: Event): void {
    this.writeText.set((event.target as HTMLTextAreaElement).value);
  }

  saveWrite(card: WriteCard): void {
    const text = this.writeText().trim();
    if (!text || this.writeSaved()) {
      this.next();
      return;
    }
    this.writeSaved.set(true);
    if (this.auth.currentUser()) {
      this.dailyService
        .complete('write', card.sourceId, { text })
        .subscribe({ next: () => this.refreshXp(), error: () => {} });
    }
    this.next();
  }

  next(): void {
    if (this.isLast()) {
      this.phase.set('done');
      return;
    }
    this.index.update((i) => i + 1);
    this.resetCardState();
  }

  /** Refreshes the XP/streak signals after a completion POST resolves — the done screen
   *  reads them live, so without this it would show whatever ngOnInit loaded before this
   *  session's cards were completed, missing the XP just earned. */
  private refreshXp(): void {
    if (!this.auth.currentUser()) return;
    this.xpService.loadSummary();
    this.xpService.loadStreak();
  }

  private resetCardState(): void {
    this.recallAnswered.set(null);
    this.writeText.set('');
    this.writeSaved.set(false);
  }

  close(): void {
    this.router.navigate(['/daily']);
  }

  restart(): void {
    this.index.set(0);
    this.completedSourceIds.clear();
    this.resetCardState();
    this.phase.set('card');
  }

  backToTrack(): void {
    this.router.navigate(['/computer-science']);
  }
}
