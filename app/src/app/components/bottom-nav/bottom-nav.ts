import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/**
 * Mobile bottom tab bar (Home / Track / Discussions / Papers / Library / Settings). Library is for signed-in
 * readers only. The curriculum
 * map stays reachable from the Computer Science page. On phones the header is hidden, so
 * Settings is where the account, language, theme and Complementary Studies links live.
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

  /** The dashboard is personal, so a logged-out visitor's Home is the landing page instead. */
  protected readonly signedIn = computed(() => !!this.auth.currentUser());
  protected readonly homeLink = computed(() => (this.signedIn() ? '/dashboard' : '/'));
}
