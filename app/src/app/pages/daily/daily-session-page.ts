import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { DailySessionService } from '../../services/daily-session.service';
import { DailyProgress, DailyProgressService } from '../../services/daily-progress.service';
import {
  DailyCard,
  DailySession,
  NoticeCard,
  ReadCard,
  WriteCard,
} from '../../models/daily.model';
import { areaBreadcrumb } from '../../shared/area-labels';
import { dailyCardTypeLabel } from '../../shared/daily-labels';

type Phase = 'card' | 'done';

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
 * The full-screen card runner (mobile mockup v2, "Sessão"): a segmented progress bar, a
 * close button and the XP earned so far, one card at a time (read / notice / write)
 * with its action pinned to the bottom, then the session-done summary. *
 * A session can legitimately have fewer than 4 cards, or zero (see
 * `daily.model.ts`) — the empty state is handled explicitly below rather
 * than assuming a card always exists.
 *
 * `DailySessionService.complete` grants XP for every card type as the user finishes it.
 *
 * "Read the full topic" parks the run in `DailyProgressService` before leaving, so coming
 * back (the return pill, or the browser's back button) lands on the same card with the
 * same XP instead of a freshly built session.
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
  private progress = inject(DailyProgressService);
  private router = inject(Router);

  protected readonly session = signal<DailySession | null>(null);
  protected readonly index = signal(0);
  protected readonly phase = signal<Phase>('card');

  /** XP earned so far in this run, shown in the top bar; each card counts once. */
  protected readonly earned = signal(0);
  private readonly earnedCards = new Set<number>();

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
    const parked = this.progress.take();
    if (parked) {
      this.restore(parked);
    } else {
      this.dailyService.build().subscribe((session) => this.session.set(session));
    }

    if (this.auth.currentUser()) {
      this.xpService.loadSummary();
      this.xpService.loadStreak();
    }
  }

  // Typed accessors — keep the template type-safe over the discriminated union.
  asRead(card: DailyCard): ReadCard {
    return card as ReadCard;
  }
  asNotice(card: DailyCard): NoticeCard {
    return card as NoticeCard;
  }
  asWrite(card: DailyCard): WriteCard {
    return card as WriteCard;
  }
  asSeen(card: DailyCard): ReadCard | NoticeCard {
    return card as ReadCard | NoticeCard;
  }

  typeLabel(card: DailyCard): string {
    return dailyCardTypeLabel(card.type);
  }

  breadcrumb(card: DailyCard): string {
    return areaBreadcrumb('module' in card ? card.module : undefined).join(' › ');
  }

  paragraphs(body: string): string[] {
    return body.split('\n\n');
  }

  inline(text: string): string {
    return renderInlineCode(text);
  }

  /** Fires the completion POST for Read/Notice at most once per card (a "Next" click can't
   *  double-grant XP even if pressed more than once before navigation). Keyed by
   *  `type:sourceId`, not bare `sourceId` — Notice falls back to reusing Read's own
   *  concept when no second source is available (`DailyService.pickNoticeEntry`), so the
   *  two cards can legitimately share a sourceId and must still be tracked separately or
   *  Notice's completion is wrongly seen as a repeat of Read's and silently dropped. */
  markSeen(card: ReadCard | NoticeCard): void {
    this.credit();
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
    this.credit();
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

  /** Counts the current card's XP towards the top-bar total, once per card per run. */
  private credit(): void {
    const card = this.current();
    if (!card || this.earnedCards.has(this.index())) return;
    this.earnedCards.add(this.index());
    this.earned.update((xp) => xp + card.xp);
  }

  private resetCardState(): void {
    this.writeText.set('');
    this.writeSaved.set(false);
  }

  /** Parks the run before "Read the full topic" navigates away; the link itself navigates. */
  openTopic(route: string[]): void {
    const session = this.session();
    if (!session) return;
    this.progress.park(
      {
        session,
        index: this.index(),
        earned: this.earned(),
        earnedCards: [...this.earnedCards],
        completedKeys: [...this.completedSourceIds],
        writeText: this.writeText(),
        writeSaved: this.writeSaved(),
      },
      this.router.serializeUrl(this.router.createUrlTree(route)),
    );
  }

  private restore(parked: DailyProgress): void {
    this.session.set(parked.session);
    this.index.set(parked.index);
    this.earned.set(parked.earned);
    parked.earnedCards.forEach((i) => this.earnedCards.add(i));
    parked.completedKeys.forEach((key) => this.completedSourceIds.add(key));
    this.writeText.set(parked.writeText);
    this.writeSaved.set(parked.writeSaved);
  }

  close(): void {
    this.progress.discard();
    this.router.navigate(['/daily']);
  }

  restart(): void {
    this.index.set(0);
    this.completedSourceIds.clear();
    this.earnedCards.clear();
    this.earned.set(0);
    this.resetCardState();
    this.phase.set('card');
  }

  backToTrack(): void {
    this.router.navigate(['/computer-science']);
  }
}
