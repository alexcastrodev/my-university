import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  COMPLEMENTARY_AREAS,
  ComplementaryArea,
} from '../computer-science/complementary-studies.data';
import {
  ComplementaryAreaProgress,
  ComplementaryStudiesService,
} from '../computer-science/complementary-studies.service';
import { MobileHome } from '../../components/mobile-home/mobile-home';
import { AuthService } from '../../services/auth.service';
import { MarkCounts, RecentActivityItem, ReviewQueueItem } from '../../models/review.model';
import { ResumePoint } from '../../models/course.model';
import { ReviewService } from '../../services/review.service';
import { ResumeService } from '../../services/resume.service';
import { SeoService } from '../../services/seo.service';
import { XpService } from '../../services/xp.service';
import { PHONE_MEDIA_QUERY } from '../../shared/breakpoints';

const PATH = '/dashboard';
const DAY_MS = 24 * 60 * 60 * 1000;

interface AreaRow {
  area: ComplementaryArea;
  read: number;
  total: number;
  xp: number;
  lastActivityAt: string | null;
}

/** "today" / "N days ago" / "N weeks ago" / "N months ago" — coarse on purpose, matching how
 *  the reference design shows recency (depth and recency, not a precise timestamp). */
function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months <= 1) return '1 month ago';
  return `${months} months ago`;
}

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MobileHome],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
})
export class DashboardPage implements OnInit {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  private resumeService = inject(ResumeService);
  private reviewService = inject(ReviewService);
  private complementaryService = inject(ComplementaryStudiesService);
  private seo = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);

  protected readonly formatRelative = formatRelative;

  /** On a first visit the user is only known once `/api/auth/me` answers, after this page
   *  has already initialised, so loading waits for the user instead of checking once. Keyed
   *  by id: the same user being re-set after that check must not load everything twice. */
  private loadedForUserId: number | null = null;
  private readonly loader = effect(() => {
    const user = this.auth.currentUser();
    if (!user || user.id === this.loadedForUserId) return;
    this.loadedForUserId = user.id;
    untracked(() => this.loadAll());
  });

  protected readonly areaProgress = signal<ComplementaryAreaProgress[]>([]);
  protected readonly areaProgressLoading = signal(true);
  protected readonly resumePoint = signal<ResumePoint | null>(null);
  protected readonly reviewQueue = signal<ReviewQueueItem[]>([]);
  protected readonly markCounts = signal<MarkCounts | null>(null);
  protected readonly recentActivity = signal<RecentActivityItem[]>([]);

  protected readonly levelPercent = computed(() => {
    const summary = this.xpService.summary();
    if (!summary) return 0;
    const { level, total } = summary;
    if (level.nextLevelXp === null) return 100;
    const span = level.nextLevelXp - level.minXp;
    if (span <= 0) return 100;
    return Math.min(100, Math.round(((total - level.minXp) / span) * 100));
  });

  protected readonly dailyGoalPercent = computed(() => {
    const goal = this.xpService.dailyGoal();
    if (!goal || goal.goal <= 0) return 0;
    return Math.min(100, Math.round((goal.earnedToday / goal.goal) * 100));
  });

  /** "Your areas": each Complementary Studies area, joined with its real read count (from the
   *  area's own list endpoint) and its real XP/last-activity (from the XP ledger). */
  protected readonly areaRows = computed<AreaRow[]>(() => {
    const progressBySlug = new Map(this.areaProgress().map((p) => [p.slug, p]));
    const xpByModule = new Map(this.xpService.areas().map((a) => [a.module, a]));
    return COMPLEMENTARY_AREAS.map((area) => {
      const progress = progressBySlug.get(area.slug);
      const xpEntry = xpByModule.get(area.slug);
      return {
        area,
        read: progress?.read ?? 0,
        total: progress?.total ?? 0,
        xp: xpEntry?.xp ?? 0,
        lastActivityAt: xpEntry?.lastActivityAt ?? null,
      };
    });
  });

  protected readonly weekTotal = computed(() =>
    this.recentActivity().reduce((sum, item) => sum + item.exp, 0),
  );

  protected readonly areasTouched = computed(
    () => new Set(this.recentActivity().map((item) => item.module)).size,
  );

  protected readonly weekRangeLabel = computed(() => {
    const now = new Date();
    const day = now.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
    const sunday = new Date(monday.getTime() + 6 * DAY_MS);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `Week of ${fmt(monday)} – ${fmt(sunday)}`;
  });

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  });

  /** Prefers the most recently marked concept (real, cross-area) over the Java exam course's
   *  resume point, since that's what a returning visitor is more likely picking back up. */
  protected readonly headline = computed(() => {
    const latest = this.recentActivity()[0];
    if (latest) return { kind: 'concept' as const, title: latest.title };
    const point = this.resumePoint();
    if (point?.lessonTitle) return { kind: 'lesson' as const, title: point.lessonTitle };
    if (point) return { kind: 'courseComplete' as const, title: point.courseTitle };
    return null;
  });

  dayLabel(dateKey: string): string {
    return new Date(`${dateKey}T00:00:00Z`)
      .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
      .toUpperCase();
  }

  ngOnInit(): void {
    this.seo.set({
      title: 'Dashboard',
      description: 'Your level, streak, daily goal, areas, and reviews due — all in one place.',
      path: PATH,
    });
  }

  /** Loads what the phone Home shows; the desktop-only panels follow on wide screens. */
  private loadAll(): void {
    this.xpService.loadSummary();
    this.xpService.loadStreak();
    this.xpService.loadDailyGoal();
    this.xpService.loadAreas();

    this.reviewService.getMarkCounts().subscribe({
      next: (counts) => this.markCounts.set(counts),
      error: () => {},
    });

    this.loadDesktopPanelsWhenWide();
  }

  /** On a phone, the areas table, ranking, review panel and weekly activity are never on
   *  screen, and the areas table alone costs one full concept list per area (a dozen requests)
   *  that would compete with the daily session the phone Home is waiting for. They load when
   *  the viewport is (or later becomes, e.g. a rotated tablet) wider than a phone. */
  private loadDesktopPanelsWhenWide(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const phone = matchMedia(PHONE_MEDIA_QUERY);
    if (!phone.matches) {
      this.loadDesktopPanels();
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) return;
      phone.removeEventListener('change', onChange);
      this.loadDesktopPanels();
    };
    phone.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => phone.removeEventListener('change', onChange));
  }

  private loadDesktopPanels(): void {
    this.xpService.loadLeaderboard();

    this.resumeService.getResumePoint().subscribe({
      next: (point) => this.resumePoint.set(point),
      error: () => {},
    });

    this.reviewService.getDueQueue().subscribe({
      next: (queue) => this.reviewQueue.set(queue),
      error: () => {},
    });

    this.reviewService.getRecentActivity().subscribe({
      next: (items) => this.recentActivity.set(items),
      error: () => {},
    });

    this.complementaryService.listProgress().subscribe({
      next: (progress) => {
        this.areaProgress.set(progress);
        this.areaProgressLoading.set(false);
      },
      error: () => this.areaProgressLoading.set(false),
    });
  }

  resumeLink(): string[] {
    const point = this.resumePoint();
    if (!point) return [];
    return point.lessonId
      ? ['/java/exam', point.courseId, 'lesson', point.lessonId]
      : ['/java/exam', point.courseId];
  }
}
