import { DOCUMENT } from '@angular/common';
import { Injectable, LOCALE_ID, effect, inject } from '@angular/core';
import { DEFAULT_LANGUAGE, Language, isSupportedLanguage } from '../models/language.model';
import { AuthService } from './auth.service';

const LANGUAGE_STORAGE_KEY = 'preferred-language';
const PT_BR_PREFIX = '/pt-BR';

/**
 * The language a page renders in is now a build-time fact (@angular/localize produces one
 * bundle per locale, dispatched by URL prefix — see the /pt-BR/ base href), not something
 * chosen at runtime. `language` is fixed for the lifetime of the request/session: reading it
 * doesn't establish a reactive dependency the way the old signal-based version did, which is
 * exactly right, since it can no longer change without a full navigation to the other locale's
 * bundle.
 *
 * Language precedence is, in order: (1) the HTTP `Accept-Language` header — decided server-side,
 * before this ever loads (see `server.ts`'s redirect); (2) the logged-in account's saved
 * `preferredLanguage`; (3) the site default (`en`). This service's constructor effect implements
 * tier 2: once the account is known, if the visitor is sitting on the site default only because
 * the header didn't have an opinion, it escalates them to their saved language — it never
 * downgrades a locale the header already picked, since that outranks the account setting. Once a
 * visitor is on a non-default locale for any reason, their account is kept in sync with it (a
 * future visit or another device should default to the same language).
 *
 * This service also drives the header's language switcher, which works by navigating to the
 * equivalent path in the other locale's bundle rather than flipping a runtime signal.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private auth = inject(AuthService);
  private document = inject(DOCUMENT);
  private localeId = inject(LOCALE_ID);

  readonly language: Language = isSupportedLanguage(this.localeId) ? this.localeId : DEFAULT_LANGUAGE;

  constructor() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, this.language);
    }

    effect(() => {
      const user = this.auth.currentUser();
      if (!user) return;
      if (user.preferredLanguage === this.language) return;

      if (this.language === DEFAULT_LANGUAGE && user.preferredLanguage) {
        this.setLanguage(user.preferredLanguage);
        return;
      }

      this.auth.updateLanguage(this.language).subscribe({ error: () => {} });
    });
  }

  /** Navigates to the equivalent path in the other locale's bundle — a full page load, since switching locale means switching bundles. */
  setLanguage(lang: Language): void {
    if (lang === this.language) return;

    if (typeof localStorage !== 'undefined') localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    if (this.auth.currentUser()) this.auth.updateLanguage(lang).subscribe({ error: () => {} });

    const location = this.document.location;
    const path = location.pathname;
    const isPtBrPath = path === PT_BR_PREFIX || path.startsWith(`${PT_BR_PREFIX}/`);
    const target =
      lang === 'pt-BR'
        ? isPtBrPath
          ? path
          : `${PT_BR_PREFIX}${path}`
        : isPtBrPath
          ? path.slice(PT_BR_PREFIX.length) || '/'
          : path;

    location.assign(`${target}${location.search}${location.hash}`);
  }
}
