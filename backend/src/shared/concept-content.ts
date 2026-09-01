import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LANGUAGE, Language, SUPPORTED_LANGUAGES } from './language';

export interface ConceptSection {
  title: string;
  content: string;
}

/** Which supported languages have a content file for this slug, discovered from what's actually in its folder. */
export function readAvailableLanguages(
  dataDir: string,
  slug: string,
): Language[] {
  const dir = join(dataDir, 'content', slug);
  if (!existsSync(dir)) return [];
  const files = new Set(readdirSync(dir));
  return SUPPORTED_LANGUAGES.filter((lang) => files.has(`${lang}.md`));
}

/** Resolves the content file to serve for a slug/language, falling back to English when the translation is missing. */
export function resolveContentPath(
  dataDir: string,
  slug: string,
  lang: Language,
): { path: string; language: Language } {
  const preferred = join(dataDir, 'content', slug, `${lang}.md`);
  if (lang !== DEFAULT_LANGUAGE && existsSync(preferred)) {
    return { path: preferred, language: lang };
  }
  return {
    path: join(dataDir, 'content', slug, `${DEFAULT_LANGUAGE}.md`),
    language: DEFAULT_LANGUAGE,
  };
}

/** Strips a wrapping pair of double quotes — needed because a YAML scalar containing `:` (e.g. a title) must be quoted, but this frontmatter reader is a plain regex, not a YAML parser. */
function unquote(value: string | null): string | null {
  if (
    value &&
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"')
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Extracts a fixed set of top-level scalar fields from a content file's frontmatter block by
 * line-matching a fixed field list, not full YAML parsing — deliberately: several existing
 * content files have unquoted titles containing a colon, which is invalid YAML a real parser
 * would reject outright, but which a line regex tolerates fine. Only scalar fields are
 * supported; structured frontmatter (arrays, nested objects) is out of scope here and every
 * concept module sources that kind of metadata from concepts.json instead.
 */
export function parseFrontmatter<F extends string>(
  raw: string,
  fields: readonly F[],
): { body: string } & Record<F, string | null> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  const frontmatterBlock = match ? match[1] : '';
  const body = match ? match[2] : raw;

  const values = {} as Record<F, string | null>;
  for (const field of fields) {
    const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
    values[field] = unquote(re.exec(frontmatterBlock)?.[1]?.trim() ?? null);
  }
  return { body, ...values };
}

/** Splits a markdown body into its `## `-delimited sections. */
export function splitSections(body: string): ConceptSection[] {
  const matches = [...body.matchAll(/^## (.+)$/gm)];
  return matches.map((match, i) => {
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? body.length)
        : body.length;
    return {
      title: match[1].trim(),
      content: body.slice(contentStart, contentEnd).trim(),
    };
  });
}

/** Reads and parses the resolved content file for a slug/language: language resolution, frontmatter fields, and the raw markdown body, in one call. */
export function readConceptContent<F extends string>(
  dataDir: string,
  slug: string,
  lang: Language,
  fields: readonly F[],
): {
  language: Language;
  availableLanguages: Language[];
  body: string;
} & Record<F, string | null> {
  const availableLanguages = readAvailableLanguages(dataDir, slug);
  const { path, language } = resolveContentPath(dataDir, slug, lang);
  const raw = readFileSync(path, 'utf-8');
  const parsed = parseFrontmatter(raw, fields);
  return { language, availableLanguages, ...parsed };
}
