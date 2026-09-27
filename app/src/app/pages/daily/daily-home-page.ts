import { ChangeDetectionStrategy, Component, LOCALE_ID, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { SeoService } from '../../services/seo.service';
import { DailySessionService } from '../../services/daily-session.service';
import { DailyCard, DailySession } from '../../models/daily.model';
import { dailyCardTypeLabel } from '../../shared/daily-labels';

const PATH = '/daily';

/** "Today": the daily-session home (mobile mockup v2, "Diário"). */
@Component({
  selector: 'app-daily-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './daily-home-page.html',
  styleUrl: './daily-home-page.css',
})
export class DailyHomePage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  private dailyService = inject(DailySessionService);
  private seo = inject(SeoService);
  private router = inject(Router);
  private locale = inject(LOCALE_ID);

  protected readonly session = signal<DailySession | null>(null);
  protected readonly loaded = computed(() => this.session() !== null);
  protected readonly isEmpty = computed(() => this.loaded() && this.cards().length === 0);

  protected readonly cards = computed<DailyCard[]>(() => this.session()?.cards ?? []);
  protected readonly potentialXp = computed(() =>
    this.cards().reduce((sum, card) => sum + card.xp, 0),
  );
  /** The streak the user will be on once this session is done: today already counts if they
   *  earned anything today, otherwise finishing the session is what extends it by one. */
  protected readonly streakAtEnd = computed(() => {
    const streak = this.xpService.streak();
    const goal = this.xpService.dailyGoal();
    if (!this.auth.currentUser() || !streak || !goal) return null;
    return goal.earnedToday > 0 ? streak.current : streak.current + 1;
  });

  protected readonly dateLabel = computed(() => {
    const d = new Date();
    const weekday = d.toLocaleDateString(this.locale, { weekday: 'long' });
    const month = d.toLocaleDateString(this.locale, { month: 'short' }).replace('.', '');
    return `${weekday} · ${d.getDate()} ${month}`.toUpperCase();
  });

  ngOnInit(): void {
    this.seo.set({
      title: 'Daily',
      description: 'Four cards. About five minutes. Your daily session, assembled when you open it.',
      path: PATH,
    });

    this.dailyService.build().subscribe((session) => this.session.set(session));

    if (this.auth.currentUser()) {
      this.xpService.loadSummary();
      this.xpService.loadStreak();
      this.xpService.loadDailyGoal();
    }
  }

  cardTypeLabel(type: DailyCard['type']): string {
    return dailyCardTypeLabel(type);
  }

  start(): void {
    this.router.navigate(['/daily/session']);
  }
}
