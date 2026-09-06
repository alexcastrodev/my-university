import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Mobile bottom tab bar (Home / Daily / Track / Map) from the mockups.
 * Rendered app-wide but only visible on phone-width viewports (see CSS).
 * Hides itself on the full-screen card runner (/daily/session), which owns
 * the whole screen with its own progress bar and close button.
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
