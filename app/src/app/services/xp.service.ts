import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class XpService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  xp = signal<number>(0);

  loadXp(): void {
    const user = this.auth.currentUser();
    if (!user) return;
    this.http.get<{ total: number }>('/api/xp', this.auth.headers()).subscribe({
      next: (res) => this.xp.set(res.total),
    });
  }
}
