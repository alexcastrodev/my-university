import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { DEFAULT_LANGUAGE, Language } from '../shared/language';

export interface QuestionTranslation {
  text: string;
  options: { key: string; text: string }[];
  explanation: string | null;
}

interface SeedQuestion extends QuestionTranslation {
  examId: string;
}

const DATA_DIR = join(__dirname, '../seed/data');

const keyOf = (examId: string, englishText: string) => `${examId}\0${englishText}`;

/**
 * The translations of a language, keyed by exam and English text. A translation is the file
 * `questions/<lang>/<topic>.json` beside `questions/<topic>.json`: same questions in the same order
 * (a spec holds that), so the English text of entry i names the translated entry i. Nothing is
 * stored in the database, which is why a topic that is already seeded gets its translation too.
 */
export function loadQuestionTranslations(lang: Language, dataDir = DATA_DIR): Map<string, QuestionTranslation> {
  const map = new Map<string, QuestionTranslation>();
  for (const ns of readdirSync(dataDir)) {
    const dir = join(dataDir, ns, 'questions', lang);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const english: SeedQuestion[] = require(join(dataDir, ns, 'questions', file));
      const translated: SeedQuestion[] = require(join(dir, file));
      english.forEach((q, i) => {
        const t = translated[i];
        if (t) map.set(keyOf(q.examId, q.text), { text: t.text, options: t.options, explanation: t.explanation });
      });
    }
  }
  return map;
}

const cache = new Map<Language, Map<string, QuestionTranslation>>();

/** Puts a translation over a question. Only fields the question already has are replaced: a public question has no `explanation`, and one must not appear. */
export function applyTranslation<T extends { text: string; options: { key: string; text: string }[] }>(
  q: T,
  t: QuestionTranslation,
): T {
  return { ...q, text: t.text, options: t.options, ...('explanation' in q ? { explanation: t.explanation } : {}) };
}

/** The question in the asked language, or unchanged when there is no translation for it. */
export function translateQuestion<T extends { text: string; options: { key: string; text: string }[] }>(
  examId: string,
  q: T,
  lang: Language,
): T {
  if (lang === DEFAULT_LANGUAGE) return q;
  let table = cache.get(lang);
  if (!table) cache.set(lang, (table = loadQuestionTranslations(lang)));
  const t = table.get(keyOf(examId, q.text));
  return t ? applyTranslation(q, t) : q;
}
