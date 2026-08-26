import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LANGUAGE, Language, SUPPORTED_LANGUAGES, normalizeLanguage } from '../shared/language';

export interface JvmConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JvmConceptSection {
  title: string;
  content: string;
}

export type ConceptLinkRef =
  | string
  | { label: string; slug: string; feature?: string };

export interface JvmConceptSummary {
  slug: string;
  id: number;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  language: Language;
  availableLanguages: Language[];
}

export interface JvmConceptDetail extends JvmConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JvmConceptSection[];
  references: JvmConceptReference[];
  related: ConceptLinkRef[];
}

interface ConceptMeta extends JvmConceptSummary {
  references: JvmConceptReference[];
  related: ConceptLinkRef[];
}

const DATA_DIR = join(__dirname, '../seed/data/jvm-concepts');

/** Strips a wrapping pair of double quotes — needed because a YAML scalar containing `:` (e.g. a title) must be quoted, but this frontmatter reader is a plain regex, not a YAML parser. */
function unquote(value: string | null): string | null {
  if (value && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseFrontmatter(raw: string): {
  body: string;
  version: string | null;
  updatedAt: string | null;
  title: string | null;
  summary: string | null;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw, version: null, updatedAt: null, title: null, summary: null };
  const [, frontmatter, body] = match;
  const version = /^version:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  const updatedAt =
    /^updatedAt:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  const title = unquote(/^title:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null);
  const summary = unquote(/^summary:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null);
  return { body, version, updatedAt, title, summary };
}

function splitSections(body: string): JvmConceptSection[] {
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

/** Which supported languages have a content file for this slug, discovered from what's actually in its folder. */
function readAvailableLanguages(slug: string): Language[] {
  const dir = join(DATA_DIR, 'content', slug);
  if (!existsSync(dir)) return [];
  const files = new Set(readdirSync(dir));
  return SUPPORTED_LANGUAGES.filter((lang) => files.has(`${lang}.md`));
}

@Injectable()
export class JvmConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(lang: Language = DEFAULT_LANGUAGE): JvmConceptSummary[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(slug: string, lang: Language = DEFAULT_LANGUAGE): JvmConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(lang: Language = DEFAULT_LANGUAGE): JvmConceptDetail[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readDetail(meta, language));
  }

  /** Resolves the content file to serve for a slug/language, falling back to English when the translation is missing. */
  private resolveContentPath(slug: string, lang: Language): { path: string; language: Language } {
    const preferred = join(DATA_DIR, 'content', slug, `${lang}.md`);
    if (lang !== DEFAULT_LANGUAGE && existsSync(preferred)) {
      return { path: preferred, language: lang };
    }
    return { path: join(DATA_DIR, 'content', slug, `${DEFAULT_LANGUAGE}.md`), language: DEFAULT_LANGUAGE };
  }

  private readSummary(meta: ConceptMeta, lang: Language): JvmConceptSummary {
    const availableLanguages = readAvailableLanguages(meta.slug);
    const { path, language } = this.resolveContentPath(meta.slug, lang);
    const { title, summary } = parseFrontmatter(readFileSync(path, 'utf-8'));

    return {
      slug: meta.slug,
      id: meta.id,
      title: title ?? meta.title,
      topic: meta.topic,
      summary: summary ?? meta.summary,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages,
    };
  }

  private readDetail(meta: ConceptMeta, lang: Language): JvmConceptDetail {
    const availableLanguages = readAvailableLanguages(meta.slug);
    const { path, language } = this.resolveContentPath(meta.slug, lang);
    const raw = readFileSync(path, 'utf-8');
    const { body, version, updatedAt, title, summary } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      title: title ?? meta.title,
      topic: meta.topic,
      summary: summary ?? meta.summary,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages,
      version,
      updatedAt,
      sections: splitSections(body),
      references: meta.references,
      related: meta.related,
    };
  }
}
