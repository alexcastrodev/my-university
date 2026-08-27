import { Injectable, inject } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { TRANSLATIONS, TranslationKeyLike } from './translations';

@Injectable({ providedIn: 'root' })
export class TranslateService {
  private languageService = inject(LanguageService);

  t(key: TranslationKeyLike, params?: Record<string, string | number>): string {
    const entry = Object.prototype.hasOwnProperty.call(TRANSLATIONS, key)
      ? TRANSLATIONS[key as keyof typeof TRANSLATIONS]
      : undefined;
    let text = entry ? entry[this.languageService.language()] : key;

    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }

    return text;
  }
}
