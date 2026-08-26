/** Languages a piece of content can be authored in. English is the mandatory fallback. */
export const SUPPORTED_LANGUAGES = ['en', 'pt-BR'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

/** Coerces an arbitrary value (e.g. a query param) to a supported language, falling back to English. */
export function normalizeLanguage(value: unknown): Language {
  return (SUPPORTED_LANGUAGES as readonly unknown[]).includes(value)
    ? (value as Language)
    : DEFAULT_LANGUAGE;
}
