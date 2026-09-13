import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'preferred-theme';

function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'light';
  return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

/**
 * Light/dark theme, applied as a `data-theme` attribute on `<html>` (see styles.css's
 * `:root[data-theme='dark']` overrides). Default is always light — there is no
 * `prefers-color-scheme` fallback, so switching is an explicit choice made once in
 * Settings and remembered per-device via localStorage, not inferred from the OS.
 *
 * A blocking inline script in index.html reads the same localStorage key before Angular
 * bootstraps, so the correct theme is already applied on first paint (no flash of the
 * wrong theme); this service takes over from there for the rest of the session.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private document = inject(DOCUMENT);

  readonly theme = signal<Theme>(readStoredTheme());

  constructor() {
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.theme());
    });
  }

  setTheme(theme: Theme): void {
    this.theme.set(theme);
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  toggle(): void {
    this.setTheme(this.theme() === 'dark' ? 'light' : 'dark');
  }
}
