import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { XpHistoryEntry, XpSummary } from '../models/xp.model';
import { AuthService } from './auth.service';
import { XpToastService } from './xp-toast.service';

@Injectable({ providedIn: 'root' })
export class XpService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private toast = inject(XpToastService);

  summary = signal<XpSummary | null>(null);
  history = signal<XpHistoryEntry[]>([]);
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
}
