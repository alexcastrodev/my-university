import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DailyCard, DailySession } from '../../models/daily.model';
import { MarkCounts } from '../../models/review.model';
import { COMPLEMENTARY_AREAS } from '../../pages/computer-science/complementary-studies.data';
import { AuthService } from '../../services/auth.service';
import { DailySessionService } from '../../services/daily-session.service';
import { XpService } from '../../services/xp.service';
import { COMPUTER_SCIENCE_LABEL } from '../../shared/area-labels';
import { isPhoneViewport } from '../../shared/breakpoints';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AREAS = 5;
const DEPTH_SEGMENTS = 5;
/** Concepts read in an area needed to light each depth segment: the first read counts, then it gets harder. */
const DEPTH_THRESHOLDS = [1, 3, 6, 12, 25];
/** Every concept or episode is worth 10 XP once, so an area's XP is ten times what was read in it. */
const XP_PER_ITEM = 10;
const RING_RADIUS = 21;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface AreaLine {
  module: string;
  title: string;
  link: string;
  /** One flag per segment: lit or not. */
  depth: boolean[];
  recency: string;
  /** Anything untouched for two weeks or more is drawn dimmer. */
  stale: boolean;
}

function recencyLabel(iso: string): { label: string; days: number } {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS));
  if (days === 0) return { label: $localize`:@@home.recency.today:today`, days };
  if (days === 1) return { label: $localize`:@@home.recency.oneDay:1 day`, days };
  if (days < 7) return { label: $localize`:@@home.recency.days:${days}:days: days`, days };
  if (days < 30) return { label: $localize`:@@home.recency.weeks:${Math.floor(days / 7)}:weeks: wk`, days };
  const months = Math.floor(days / 30);
  if (months === 1) return { label: $localize`:@@home.recency.oneMonth:1 mo`, days };
  return { label: $localize`:@@home.recency.months:${months}:months: mo`, days };
}

/**
 * The phone version of the dashboard (mobile mockup v2, "Início"): today's session up top
 * with one tap to start it, then level, streak and daily goal side by side, the review
 * backlog, and the areas studied recently with how deep and how fresh each one is.
 * The dashboard page renders it only below the tablet breakpoint and passes in what it
 * already loaded; the daily session itself is fetched here, and only on phones.
 */
@Component({
  selector: 'app-mobile-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './mobile-home.html',
  styleUrl: './mobile-home.css',
})
export class MobileHome implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  private dailyService = inject(DailySessionService);
  private platformId = inject(PLATFORM_ID);

  readonly markCounts = input<MarkCounts | null>(null);

  protected readonly ringCircumference = RING_CIRCUMFERENCE;
  /** Placeholder rows while the session and the areas are still on their way. */
  protected readonly skeletonRows = [0, 1, 2];
  protected readonly session = signal<DailySession | null>(null);
  protected readonly cards = computed<DailyCard[]>(() => this.session()?.cards ?? []);
  protected readonly potentialXp = computed(() => this.cards().reduce((sum, c) => sum + c.xp, 0));

  protected readonly firstName = computed(
    () => this.auth.currentUser()?.displayName.split(' ')[0] ?? '',
  );

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return $localize`:@@home.greeting.morning:Good morning`;
    if (hour < 18) return $localize`:@@home.greeting.afternoon:Good afternoon`;
    return $localize`:@@home.greeting.evening:Good evening`;
  });

  /** Stroke offset of the level ring: how much of the current level is still missing. */
  protected readonly ringOffset = computed(() => {
    const summary = this.xpService.summary();
    if (!summary) return RING_CIRCUMFERENCE;
    const { level, total } = summary;
    if (level.nextLevelXp === null) return 0;
    const span = level.nextLevelXp - level.minXp;
    const progress = span > 0 ? Math.min(1, (total - level.minXp) / span) : 1;
    return RING_CIRCUMFERENCE * (1 - progress);
  });

  protected readonly goalPercent = computed(() => {
    const goal = this.xpService.dailyGoal();
    if (!goal || goal.goal <= 0) return 0;
    return Math.min(100, Math.round((goal.earnedToday / goal.goal) * 100));
  });

  protected readonly dueNow = computed(() => this.markCounts()?.expired ?? 0);
  /** A backlog is easier to start on in small bites; five is what one sitting comfortably holds. */
  protected readonly reviewBite = computed(() => Math.min(5, this.dueNow()));

  protected readonly areas = computed<AreaLine[]>(() =>
    [...this.xpService.areas()]
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, MAX_AREAS)
      .map((entry) => {
        const known = COMPLEMENTARY_AREAS.find((a) => a.slug === entry.module);
        const read = Math.round(entry.xp / XP_PER_ITEM);
        const { label, days } = recencyLabel(entry.lastActivityAt);
        return {
          module: entry.module,
          title: known?.title ?? COMPUTER_SCIENCE_LABEL,
          link: known?.routerLink ?? '/computer-science',
          depth: DEPTH_THRESHOLDS.slice(0, DEPTH_SEGMENTS).map((min) => read >= min),
          recency: label,
          stale: days >= 14,
        };
      }),
  );

  ngOnInit(): void {
    // Desktop renders the full dashboard instead and never shows this component, so it
    // shouldn't pay for assembling a session nobody will see.
    if (!isPlatformBrowser(this.platformId) || !isPhoneViewport()) return;
    this.dailyService.build().subscribe({
      next: (session) => this.session.set(session),
      error: () => this.session.set({ estimatedMinutes: 0, cards: [], summary: { headline: '', tomorrow: { title: '', body: '' } } }),
    });
  }
}
