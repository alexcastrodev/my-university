import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AchievementsView, AwardView, CatalogTrackView, TrackRequirementsView, UnitAwardView } from '../models/achievements.model';
import {
  AreaXpBreakdownEntry,
  DailyGoalStatus,
  LeaderboardEntry,
  StreakInfo,
  XpHistoryEntry,
  XpHistoryPage,
  XpSummary,
} from '../models/xp.model';
import { AuthService } from './auth.service';
import { AwardCelebrationService } from './award-celebration.service';
import { XpToastService } from './xp-toast.service';

const HISTORY_PAGE_SIZE = 20;

@Injectable({ providedIn: 'root' })
export class XpService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private toast = inject(XpToastService);
  private celebration = inject(AwardCelebrationService);

  summary = signal<XpSummary | null>(null);
  /** The activity loaded so far, newest first; "Load more" appends to it. */
  history = signal<XpHistoryEntry[]>([]);
  historyHasMore = signal(false);
  /** True while a page is being fetched, so the button cannot fire twice. */
  historyLoading = signal(false);
  historyError = signal(false);
  streak = signal<StreakInfo | null>(null);
  dailyGoal = signal<DailyGoalStatus | null>(null);
  leaderboard = signal<LeaderboardEntry[]>([]);
  areas = signal<AreaXpBreakdownEntry[]>([]);
  /** Tells "still loading" apart from "nothing read yet": both leave `areas` empty. */
  areasLoaded = signal(false);
  xp = computed(() => this.summary()?.total ?? 0);
  /** Awards and progress; null until the first sync finishes, so "not loaded" is never shown as "nothing earned". */
  achievements = signal<AchievementsView | null>(null);
  achievementsError = signal(false);
  /** Every track with its badges and trophy, for the "Available" view; null until loaded. */
  achievementCatalog = signal<CatalogTrackView[] | null>(null);
  achievementCatalogError = signal(false);
  /** What each opened track asks for, by track id. Cleared whenever the catalog reloads, so "done" marks stay fresh. */
  trackRequirements = signal<Record<string, TrackRequirementsView>>({});
  /** Tracks whose list failed to load, so the panel can offer a retry. */
  trackRequirementsFailed = signal<Record<string, true>>({});
  private requirementsInFlight = new Set<string>();

  private hasLoadedOnce = false;
  /** Awards already announced, per user, so a repeated sync or a reload never announces one twice. */
  private announced = new Set<string>();
  /** Syncs run one at a time: two never race each other for the same user. */
  private syncChain: Promise<void> = Promise.resolve();

  /**
   * Loads the XP summary. A rise in total after the first load means an action just granted XP:
   * show the toast and sync achievements, announcing any award. The first load syncs silently, so
   * awards earned earlier (or backfilled) are recorded without being presented as news.
   * `silent` refreshes the baseline without a toast, used after a sync that added award XP.
   */
  loadSummary(silent = false): void {
    const user = this.auth.currentUser();
    if (!user) return;

    this.http.get<XpSummary>('/api/xp/summary').subscribe({
      next: (next) => {
        if (this.auth.currentUser()?.id !== user.id) return;
        const previousTotal = this.summary()?.total;
        const grew = this.hasLoadedOnce && previousTotal !== undefined && next.total > previousTotal;
        if (grew && !silent) this.toast.show(next.total - previousTotal!);
        const firstLoad = !this.hasLoadedOnce;
        this.hasLoadedOnce = true;
        this.summary.set(next);
        if (!silent && (grew || firstLoad)) void this.syncAchievements(grew);
      },
    });
  }

  /**
   * Records the awards the user has earned and refreshes the collection. Resolves when done; never
   * rejects (a failure sets `achievementsError`, which the page shows with a retry).
   */
  syncAchievements(announce: boolean): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return Promise.resolve();
    const run = async (): Promise<void> => {
      const stale = () => this.auth.currentUser()?.id !== user.id;
      try {
        const { newAwards } = await firstValueFrom(
          this.http.post<{ newAwards: AwardView[] }>('/api/xp/achievements/sync', {}),
        );
        if (stale()) return;
        if (announce) newAwards.forEach((award) => this.announce(user.id, award));
        if (newAwards.length > 0) this.loadSummary(true);
        const view = await firstValueFrom(this.http.get<AchievementsView>('/api/xp/achievements'));
        if (stale()) return;
        this.achievements.set(view);
        this.achievementsError.set(false);
      } catch {
        if (!stale()) this.achievementsError.set(true);
      }
    };
    this.syncChain = this.syncChain.then(run);
    return this.syncChain;
  }

  /**
   * Awards an action just earned, straight from its response. The server already recorded them in the
   * same transaction as the unit, so this only announces (once per award) and refreshes the collection.
   * Ignored when the user changed since the request was sent.
   */
  receiveAwards(userId: number, awards: AwardView[]): void {
    if (this.auth.currentUser()?.id !== userId) return;
    const fresh = awards.filter((award) => this.announce(userId, award));
    if (fresh.length > 0) void this.syncAchievements(false);
  }

  /** Loads the catalog of everything that can be earned, with the user's progress. Never rejects; failure sets the error flag. */
  async loadAchievementCatalog(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;
    try {
      const view = await firstValueFrom(this.http.get<CatalogTrackView[]>('/api/xp/achievements/catalog'));
      if (this.auth.currentUser()?.id !== user.id) return;
      this.achievementCatalog.set(view);
      this.trackRequirements.set({});
      this.trackRequirementsFailed.set({});
      this.achievementCatalogError.set(false);
    } catch {
      if (this.auth.currentUser()?.id === user.id) this.achievementCatalogError.set(true);
    }
  }

  /** Loads what one track asks for, once: a track already loaded or loading is left alone. Never rejects. */
  async loadTrackRequirements(trackId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || this.trackRequirements()[trackId] || this.requirementsInFlight.has(trackId)) return;
    this.requirementsInFlight.add(trackId);
    try {
      const view = await firstValueFrom(this.http.get<TrackRequirementsView>(`/api/xp/achievements/catalog/${trackId}`));
      if (this.auth.currentUser()?.id !== user.id) return;
      this.trackRequirements.update((all) => ({ ...all, [trackId]: view }));
      this.trackRequirementsFailed.update(({ [trackId]: _gone, ...rest }) => rest);
    } catch {
      if (this.auth.currentUser()?.id === user.id) this.trackRequirementsFailed.update((all) => ({ ...all, [trackId]: true }));
    } finally {
      this.requirementsInFlight.delete(trackId);
    }
  }

  /** Celebrates an award (a dialog, see `AwardCelebrationService`); false when this user was already told about it. */
  private announce(userId: number, award: AwardView): boolean {
    const key = `${userId}:${award.type}:${award.id}`;
    if (this.announced.has(key)) return false;
    this.announced.add(key);
    this.celebration.show(award);
    return true;
  }

  /**
   * The prize the unit at `path` (e.g. `/dotnet-concepts/<slug>`) counts toward, with the user's progress.
   * Null when signed out, when no track holds the unit, or when the request fails: the box is only a hint.
   */
  async loadUnitAward(path: string): Promise<UnitAwardView | null> {
    if (!this.auth.currentUser()) return null;
    try {
      return await firstValueFrom(this.http.get<UnitAwardView | null>('/api/xp/achievements/unit', { params: { path } }));
    } catch {
      return null;
    }
  }

  /** First page of the activity list; replaces whatever was loaded before. */
  loadHistory(): void {
    this.fetchHistory(0, true);
  }

  /** Next page, appended. Repeats are dropped by id: a row recorded between two pages only shifts the list. */
  loadMoreHistory(): void {
    if (this.historyLoading() || !this.historyHasMore()) return;
    this.fetchHistory(this.history().length, false);
  }

  private fetchHistory(offset: number, replace: boolean): void {
    const user = this.auth.currentUser();
    if (!user || this.historyLoading()) return;
    this.historyLoading.set(true);
    this.historyError.set(false);

    this.http.get<XpHistoryPage>('/api/xp/history/paged', { params: { limit: HISTORY_PAGE_SIZE, offset } }).subscribe({
      next: (page) => {
        this.historyLoading.set(false);
        if (this.auth.currentUser()?.id !== user.id) return;
        this.history.update((current) => {
          if (replace) return page.items;
          const seen = new Set(current.map((e) => e.id));
          return [...current, ...page.items.filter((e) => !seen.has(e.id))];
        });
        this.historyHasMore.set(page.hasMore);
      },
      error: () => {
        this.historyLoading.set(false);
        this.historyError.set(true);
      },
    });
  }

  loadStreak(): void {
    const user = this.auth.currentUser();
    if (!user) return;

    this.http.get<StreakInfo>('/api/xp/streak').subscribe({
      next: (streak) => this.streak.set(streak),
    });
  }

  loadDailyGoal(): void {
    const user = this.auth.currentUser();
    if (!user) return;

    this.http.get<DailyGoalStatus>('/api/xp/daily-goal').subscribe({
      next: (status) => this.dailyGoal.set(status),
    });
  }

  /** Public — no login required, so it can be shown to anonymous visitors too. */
  loadLeaderboard(): void {
    this.http.get<LeaderboardEntry[]>('/api/xp/leaderboard').subscribe({
      next: (entries) => this.leaderboard.set(entries),
    });
  }

  loadAreas(): void {
    const user = this.auth.currentUser();
    if (!user) return;

    this.http.get<AreaXpBreakdownEntry[]>('/api/xp/areas').subscribe({
      next: (entries) => {
        this.areas.set(entries);
        this.areasLoaded.set(true);
      },
      error: () => this.areasLoaded.set(true),
    });
  }
}
