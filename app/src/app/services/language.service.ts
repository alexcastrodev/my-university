import { Injectable, effect, inject, signal } from '@angular/core';
import { DEFAULT_LANGUAGE, Language, isSupportedLanguage } from '../models/language.model';
import { AuthService } from './auth.service';

const LANGUAGE_STORAGE_KEY = 'preferred-language';

function readStoredLanguage(): Language {
  if (typeof localStorage === 'undefined') return DEFAULT_LANGUAGE;
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE;
}

/**
 * Anonymous visitors keep their language choice in localStorage only. Once logged in, the
 * user's saved preference takes over; if they don't have one yet, their current local choice
 * becomes it, so it follows them across devices from then on.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private auth = inject(AuthService);

  readonly language = signal<Language>(readStoredLanguage());

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (!user) return;

      if (user.preferredLanguage && isSupportedLanguage(user.preferredLanguage)) {
        this.applyLocal(user.preferredLanguage);
      } else {
        this.auth.updateLanguage(this.language()).subscribe({ error: () => {} });
      }
    });
  }

  setLanguage(lang: Language): void {
    this.applyLocal(lang);
    if (this.auth.currentUser()) {
      this.auth.updateLanguage(lang).subscribe({ error: () => {} });
    }
  }

  /**
   * Applies a language for this URL/session without touching the user's saved account
   * preference. Used when a locale-prefixed route (e.g. /pt-BR/...) determines the language
   * from the URL itself — landing there shouldn't silently overwrite what a logged-in user
   * chose to save as their preference.
   */
  setLanguageFromUrl(lang: Language): void {
    this.applyLocal(lang);
  }

  private applyLocal(lang: Language): void {
    this.language.set(lang);
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }
}
