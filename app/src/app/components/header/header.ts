import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="header" role="banner">
      <div class="header-left">
        <a routerLink="/" class="brand" aria-label="My University Home">
          <span class="brand-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="currentColor"/>
              <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" fill="currentColor" opacity=".8"/>
            </svg>
          </span>
          <span class="brand-name">My<strong>University</strong></span>
        </a>
        <nav class="nav-links" aria-label="Main navigation">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" class="nav-link">Exams</a>
        </nav>
      </div>
      <div class="header-right">
        <div class="search-box" role="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input type="search" placeholder="What do you want to learn?" aria-label="Search courses" />
        </div>
        <button class="avatar" aria-label="User account menu" type="button" (click)="toggleUser()">
          {{ userInitials() }}
        </button>
      </div>
    </header>
  `,
  styles: `
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1a1a1a;
      color: #fff;
      height: 52px;
      padding: 0 1.25rem;
      gap: 1rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 1px 0 rgba(255,255,255,.08);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex: 1;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      text-decoration: none;
      color: #fff;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .brand-icon { display: flex; align-items: center; color: #c74634; }
    .brand-name { font-size: 0.95rem; font-weight: 400; letter-spacing: 0.01em; }
    .brand-name strong { font-weight: 700; }

    .nav-links { display: flex; align-items: center; gap: 0.25rem; }

    .nav-link {
      color: #ccc;
      text-decoration: none;
      font-size: 0.8rem;
      padding: 0.35rem 0.65rem;
      border-radius: 4px;
      transition: color .15s, background .15s;
      white-space: nowrap;
    }

    .nav-link:hover, .nav-link.active { color: #fff; background: rgba(255,255,255,.08); }

    .header-right { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }

    .search-box {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255,255,255,.1);
      border: 1px solid rgba(255,255,255,.15);
      border-radius: 6px;
      padding: 0.35rem 0.75rem;
      color: #aaa;
      width: 260px;
      transition: background .15s;
    }

    .search-box:focus-within { background: rgba(255,255,255,.15); color: #fff; }

    .search-box input {
      background: none;
      border: none;
      outline: none;
      color: #fff;
      font-size: 0.8rem;
      width: 100%;
    }

    .search-box input::placeholder { color: #888; }

    .avatar {
      min-width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #c74634;
      color: #fff;
      border: none;
      padding: 0 0.65rem;
      font-size: 0.7rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity .15s;
    }

    .avatar:hover { opacity: .85; }
  `,
})
export class Header {
  private auth = inject(AuthService);

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
      if (confirm(`Sign out ${user.displayName}?`)) this.auth.logout();
      return;
    }

    const displayName = prompt('Name');
    if (!displayName) return;

    this.auth.login(displayName).subscribe();
  }
}
