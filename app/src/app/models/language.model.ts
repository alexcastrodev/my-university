export const SUPPORTED_LANGUAGES = ['en', 'pt-BR'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isSupportedLanguage(value: unknown): value is Language {
  return (SUPPORTED_LANGUAGES as readonly unknown[]).includes(value);
}

/** Each language's name in its own language, as the switchers list it. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};
