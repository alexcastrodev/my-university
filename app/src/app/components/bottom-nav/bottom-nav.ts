import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';

/**
 * Mobile bottom tab bar (Home / Daily / Track / Feed / Settings) from the mockups. The curriculum
 * map stays reachable from the Computer Science page. On phones the header is hidden, so
 * Settings is where the account, language, theme and Complementary Studies links live.
 * Rendered app-wide but only visible on phone-width viewports (see CSS).
 * Hides itself on the full-screen card runner (/daily/session), which owns
 * the whole screen with its own progress bar and close button.
 * The Home tab points to the dashboard only when signed in; signed-out visitors go to the landing page.
 */
@Component({
  selector: 'app-bottom-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
  styleUrl: './bottom-nav.css',
})
export class BottomNav {
  private router = inject(Router);
  private auth = inject(AuthService);

  protected readonly homeLink = computed(() => (this.auth.currentUser() ? '/dashboard' : '/'));

  protected readonly hidden = signal(this.shouldHide(this.router.url));

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.hidden.set(this.shouldHide(e.urlAfterRedirects)));
  }

  private shouldHide(url: string): boolean {
    return url.startsWith('/daily/session');
  }
}
