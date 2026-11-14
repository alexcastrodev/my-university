import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../services/auth.service';

/** Where the Study tab leads to: the hub itself and everything a card on it opens. */
const STUDY_URL = /^\/(studies|tracks|exams?|papers|computer-science)(?:[/?#]|$)/;

/**
 * Mobile bottom tab bar (Home / Study / Discussions / Library / Settings). Library is for signed-in
 * readers only. Study opens a hub of cards (Tracks, Certifications, Papers, Computer Science) and
 * stays highlighted on any of them. The curriculum map stays reachable from the Computer Science
 * page. On phones the header is hidden, so Settings is where the account, language, theme and
 * Complementary Studies links live.
 * Rendered app-wide but only visible on phone-width viewports (see CSS).
 */
@Component({
  selector: 'app-bottom-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
  styleUrl: './bottom-nav.css',
})
export class BottomNav {
  private auth = inject(AuthService);
  private router = inject(Router);

  /** routerLinkActive only matches its own URL, so Study tracks the whole area by hand. */
  protected readonly inStudies = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => STUDY_URL.test(e.urlAfterRedirects)),
      startWith(STUDY_URL.test(this.router.url)),
    ),
    { requireSync: true },
  );

  /** The dashboard is personal, so a logged-out visitor's Home is the landing page instead. */
  protected readonly signedIn = computed(() => !!this.auth.currentUser());
  protected readonly homeLink = computed(() => (this.signedIn() ? '/dashboard' : '/'));
}
