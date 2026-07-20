import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { XpService } from '../../services/xp.service';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  protected auth = inject(AuthService);
  protected xpService = inject(XpService);
  private router = inject(Router);

  userInitials = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return 'Sign in';

    return user.displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  });

  toggleUser(): void {
    const user = this.auth.currentUser();
    if (user) {
      if (confirm(`Sign out ${user.displayName}?`)) {
        this.auth.logout();
        void this.router.navigate(['/login']);
      }
      return;
    }
    void this.router.navigate(['/login']);
  }
}
