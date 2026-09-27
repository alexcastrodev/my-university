import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { DailyProgressService } from '../../services/daily-progress.service';

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * "Back to the daily session" button, shown while the user is reading a topic they opened
 * from a daily card. Only on that topic's page: wandering elsewhere hides it, and the parked
 * session is still restored whenever the runner is opened again.
 */
@Component({
  selector: 'app-daily-return-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './daily-return-pill.html',
  styleUrl: './daily-return-pill.css',
})
export class DailyReturnPill {
  private router = inject(Router);
  private progress = inject(DailyProgressService);

  private readonly url = signal(pathOf(this.router.url));

  protected readonly visible = computed(() => {
    const topic = this.progress.topicUrl();
    if (!topic) return false;
    const url = this.url();
    return url === topic || url.startsWith(`${topic}/`);
  });

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.url.set(pathOf(e.urlAfterRedirects)));
  }
}
