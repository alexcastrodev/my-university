import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TranslatePipe } from '../../shared/i18n/translate.pipe';

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  error = signal(false);
  devModeEnabled = signal(false);
  devLoggingIn = signal(false);

  ngOnInit(): void {
    if (this.auth.currentUser()) {
      void this.router.navigateByUrl('/java/exams');
      return;
    }
    this.error.set(this.route.snapshot.queryParamMap.get('error') === 'oauth_failed');

    if (typeof localStorage === 'undefined') return;
    this.auth.isDevModeEnabled().subscribe({
      next: (enabled) => this.devModeEnabled.set(enabled),
      error: () => this.devModeEnabled.set(false),
    });
  }

  devLogin(): void {
    if (this.devLoggingIn()) return;
    this.devLoggingIn.set(true);
    this.auth.devLogin().subscribe({
      next: () => {
        this.devLoggingIn.set(false);
        void this.router.navigateByUrl('/java/exams');
      },
      error: () => this.devLoggingIn.set(false),
    });
  }
}
