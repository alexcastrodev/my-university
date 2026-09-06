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

/**
 * The full-screen card runner (mockups tmp/mobile/, screens 02–06):
 * a segmented progress bar, a close button, one card at a time
 * (recall / read / notice / write), then the session-done summary.
 *
 * XP is not awarded here yet — that requires the backend session endpoint
 * (tasks.md · grupo F). The done screen reflects the user's live Xp/streak.
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
  protected readonly selectedOption = signal<number | null>(null);
  protected readonly checked = signal(false);
  protected readonly gaveUp = signal(false);

  // Write per-card state
  protected readonly writeText = signal('');

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

  selectOption(i: number): void {
    if (this.checked()) return;
    this.selectedOption.set(i);
  }

  check(): void {
    if (this.selectedOption() === null) return;
    this.checked.set(true);
  }

  showAnswer(): void {
    this.gaveUp.set(true);
    this.checked.set(true);
  }

  /** Style state for a recall option once checked: correct / wrong / neutral. */
  optionState(card: RecallCard, i: number): 'idle' | 'selected' | 'correct' | 'wrong' {
    if (!this.checked()) {
      return this.selectedOption() === i ? 'selected' : 'idle';
    }
    if (i === card.correctIndex) return 'correct';
    if (i === this.selectedOption()) return 'wrong';
    return 'idle';
  }

  recallResolved(card: RecallCard): boolean {
    return this.checked();
  }

  recallWrong(card: RecallCard): boolean {
    return this.checked() && (this.gaveUp() || this.selectedOption() !== card.correctIndex);
  }

  onWriteInput(event: Event): void {
    this.writeText.set((event.target as HTMLTextAreaElement).value);
  }

  next(): void {
    if (this.isLast()) {
      this.phase.set('done');
      return;
    }
    this.index.update((i) => i + 1);
    this.resetCardState();
  }

  private resetCardState(): void {
    this.selectedOption.set(null);
    this.checked.set(false);
    this.gaveUp.set(false);
    this.writeText.set('');
  }

  close(): void {
    this.router.navigate(['/daily']);
  }

  restart(): void {
    this.index.set(0);
    this.resetCardState();
    this.phase.set('card');
  }

  backToTrack(): void {
    this.router.navigate(['/computer-science']);
  }
}
