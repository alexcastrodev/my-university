import { Language, SUPPORTED_LANGUAGES } from '../models/language.model';

const PT_BR_PREFIX = '/pt-BR';

/**
 * The hreflang set of a page, from its English path: the page itself and its twin at `/pt-BR` + path.
 * A language is listed only when that translation exists, so a detail page passes the item's
 * `availableLanguages`; a list page has no such list and exists in every language.
 */
export function localizedAlternates(
  path: string,
  availableLanguages: readonly Language[] = SUPPORTED_LANGUAGES,
): { lang: Language; path: string }[] {
  return SUPPORTED_LANGUAGES.filter((lang) => availableLanguages.includes(lang)).map((lang) => ({
    lang,
    path: lang === 'en' ? path : `${PT_BR_PREFIX}${path}`,
  }));
}
