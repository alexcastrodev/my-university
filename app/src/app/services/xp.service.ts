import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  DailyGoalStatus,
  LeaderboardEntry,
  StreakInfo,
  XpHistoryEntry,
  XpSummary,
} from '../models/xp.model';
import { AuthService } from './auth.service';
import { XpToastService } from './xp-toast.service';

@Injectable({ providedIn: 'root' })
export class XpService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private toast = inject(XpToastService);

  summary = signal<XpSummary | null>(null);
  history = signal<XpHistoryEntry[]>([]);
  streak = signal<StreakInfo | null>(null);
  dailyGoal = signal<DailyGoalStatus | null>(null);
  leaderboard = signal<LeaderboardEntry[]>([]);
  xp = computed(() => this.summary()?.total ?? 0);

  private hasLoadedOnce = false;

  loadSummary(): void {
    const user = this.auth.currentUser();
    if (!user) return;

    this.http.get<XpSummary>('/api/xp/summary').subscribe({
      next: (next) => {
        const previousTotal = this.summary()?.total;
        if (this.hasLoadedOnce && previousTotal !== undefined && next.total > previousTotal) {
          this.toast.show(next.total - previousTotal);
        }
        this.hasLoadedOnce = true;
        this.summary.set(next);
      },
    });
  }

  loadHistory(): void {
    const user = this.auth.currentUser();
    if (!user) return;

    this.http.get<XpHistoryEntry[]>('/api/xp/history').subscribe({
      next: (entries) => this.history.set(entries),
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
}
