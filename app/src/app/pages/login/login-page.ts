import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="page">
      <div class="card">
        <div class="logo" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="#c74634"/>
            <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" fill="#c74634" opacity=".7"/>
          </svg>
        </div>
        <h1 class="title">Welcome back</h1>
        <p class="subtitle">Enter your name to continue</p>

        <form class="form" (ngSubmit)="submit()">
          <input
            class="input"
            type="text"
            placeholder="Your name"
            [(ngModel)]="name"
            name="name"
            autocomplete="name"
            autofocus
            [disabled]="loading()"
          />
          @if (error()) {
            <p class="error-msg" role="alert">{{ error() }}</p>
          }
          <button class="btn" type="submit" [disabled]="loading() || !name().trim()">
            {{ loading() ? 'Signing in…' : 'Continue' }}
          </button>
        </form>
      </div>
    </div>
  `,
  styles: `
    .page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 52px);
      background: #f3f4f6;
      padding: 2rem 1rem;
    }

    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      box-shadow: 0 4px 24px rgba(0,0,0,.06);
    }

    .logo { margin-bottom: 0.5rem; }

    .title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #111827;
      margin: 0;
      text-align: center;
    }

    .subtitle {
      font-size: 0.85rem;
      color: #6b7280;
      margin: 0 0 1rem;
      text-align: center;
    }

    .form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .input {
      width: 100%;
      padding: 0.65rem 0.875rem;
      border: 1.5px solid #d1d5db;
      border-radius: 8px;
      font-size: 0.9rem;
      color: #111827;
      outline: none;
      transition: border-color .15s;
      box-sizing: border-box;
    }

    .input:focus { border-color: #c74634; }
    .input:disabled { background: #f9fafb; color: #9ca3af; }

    .error-msg {
      font-size: 0.8rem;
      color: #dc2626;
      margin: 0;
    }

    .btn {
      width: 100%;
      padding: 0.65rem;
      background: #c74634;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s;
    }

    .btn:hover:not(:disabled) { opacity: .88; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  name = signal('');
  loading = signal(false);
  error = signal('');

  submit() {
    const displayName = this.name().trim();
    if (!displayName || this.loading()) return;

    this.loading.set(true);
    this.error.set('');

    this.auth.login(displayName).subscribe({
      next: () => {
        this.loading.set(false);
        void this.router.navigateByUrl('/');
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Something went wrong. Try again.');
      },
    });
  }
}
