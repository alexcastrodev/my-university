import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';
import { SeoService } from '../../services/seo.service';
import { DailySessionService } from '../../services/daily-session.service';
import { DailyCard, DailySession } from '../../models/daily.model';

const PATH = '/daily';

/** "Today" — the daily-session home (mockups tmp/mobile/, screen 01). */
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

  protected readonly session = signal<DailySession | null>(null);

  protected readonly cards = computed<DailyCard[]>(() => this.session()?.cards ?? []);
  protected readonly potentialXp = computed(() =>
    this.cards().reduce((sum, card) => sum + card.xp, 0),
  );

  protected readonly dateLabel = computed(() => {
    const d = new Date();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const month = d.toLocaleDateString('en-US', { month: 'long' });
    return `${weekday} ${d.getDate()} ${month}`.toUpperCase();
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
    }
  }

  cardTypeLabel(type: DailyCard['type']): string {
    return type.toUpperCase();
  }

  start(): void {
    this.router.navigate(['/daily/session']);
  }
}
