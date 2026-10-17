import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './auth.service';

const API = '/api/discussions/notifications';

export interface NotificationItem {
  id: number;
  read: boolean;
  createdAt: string;
  actor: string;
  excerpt: string;
  conceptTitle: string;
  route: string[];
  markerId: number;
  lab: boolean;
}

/**
 * Reply notifications of the signed-in reader. The unread count (the sidebar badge) is looked up on
 * sign-in and after every navigation: no polling timer, a reply shows up on the next page change.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  unread = signal(0);
  items = signal<NotificationItem[]>([]);
  loading = signal(false);
  error = signal(false);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.refreshUnread());
    effect(() => {
      if (this.auth.currentUser()) this.refreshUnread();
      else this.unread.set(0);
    });
  }

  refreshUnread(): void {
    if (!this.auth.currentUser()) return;
    this.http.get<{ unread: number }>(`${API}/unread`).subscribe({
      next: (r) => this.unread.set(r.unread),
      error: () => undefined, // the badge is an extra: stay quiet when it can't load
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(false);
    this.http.get<{ unread: number; items: NotificationItem[] }>(API).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.unread.set(r.unread);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  markRead(item: NotificationItem): void {
    if (item.read) return;
    this.items.update((list) => list.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    this.unread.update((n) => Math.max(0, n - 1));
    this.http.post(`${API}/${item.id}/read`, {}).subscribe();
  }

  markAllRead(): void {
    this.items.update((list) => list.map((n) => ({ ...n, read: true })));
    this.unread.set(0);
    this.http.post(`${API}/read`, {}).subscribe();
  }
}
