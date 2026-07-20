import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';

type Mode = 'login' | 'signup';

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  mode = signal<Mode>('login');
  name = signal('');
  loading = signal(false);
  error = signal('');
  suggestSignup = signal(false);
  suggestLogin = signal(false);

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set('');
    this.suggestSignup.set(false);
    this.suggestLogin.set(false);
  }

  submit() {
    const displayName = this.name().trim();
    if (!displayName || this.loading()) return;

    this.loading.set(true);
    this.error.set('');
    this.suggestSignup.set(false);
    this.suggestLogin.set(false);

    const request$ = this.mode() === 'login'
      ? this.auth.login(displayName)
      : this.auth.signup(displayName);

    request$.subscribe({
      next: () => {
        this.loading.set(false);
        void this.router.navigateByUrl('/');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        if (this.mode() === 'login' && err.status === 404) {
          this.error.set(`No account named "${displayName}".`);
          this.suggestSignup.set(true);
        } else if (this.mode() === 'signup' && err.status === 409) {
          this.error.set(`Name "${displayName}" is already taken.`);
          this.suggestLogin.set(true);
        } else {
          this.error.set('Something went wrong. Try again.');
        }
      },
    });
  }
}
