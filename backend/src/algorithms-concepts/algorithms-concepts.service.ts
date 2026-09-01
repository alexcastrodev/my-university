import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { DEFAULT_LANGUAGE, Language, SUPPORTED_LANGUAGES, normalizeLanguage } from '../shared/language';

export type AlgorithmsConceptCategory =
  | 'Fundamentals'
  | 'Sorting'
  | 'Data Structures'
  | 'Graphs'
  | 'Strings'
  | 'Dynamic Programming & Greedy';

export interface AlgorithmsConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface AlgorithmsConceptSection {
  title: string;
  content: string;
}

export interface AlgorithmsConceptSummary {
  slug: string;
  id: number;
  category: AlgorithmsConceptCategory;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
  language: Language;
  availableLanguages: Language[];
}

export interface AlgorithmsConceptDetail extends AlgorithmsConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: AlgorithmsConceptSection[];
  references: AlgorithmsConceptReference[];
}

interface ConceptMeta extends AlgorithmsConceptSummary {
  references: AlgorithmsConceptReference[];
}

interface AlgorithmsConceptFrontmatter {
  title?: string;
  description?: string;
  version?: string;
  updatedAt?: string;
}

const DATA_DIR = join(__dirname, '../seed/data/algorithms-concepts');

/** Which supported languages have a content file for this slug, discovered from what's actually in its folder. */
function readAvailableLanguages(slug: string): Language[] {
  const dir = join(DATA_DIR, 'content', slug);
  if (!existsSync(dir)) return [];
  const files = new Set(readdirSync(dir));
  return SUPPORTED_LANGUAGES.filter((lang) => files.has(`${lang}.md`));
}

function parseFrontmatter(raw: string): {
  body: string;
  frontmatter: AlgorithmsConceptFrontmatter;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw, frontmatter: {} };
  const [, frontmatterBlock, body] = match;
  // yaml.load handles quoted strings with colons (needed for title/description); version and
  // updatedAt are pulled from the raw text instead, so "1.0" stays "1.0" rather than becoming
  // the JS number 1 and losing its trailing zero.
  const parsed = (yaml.load(frontmatterBlock) as AlgorithmsConceptFrontmatter) ?? {};
  const version = /^version:\s*(.+)$/m.exec(frontmatterBlock)?.[1]?.trim();
  const updatedAt = /^updatedAt:\s*(.+)$/m.exec(frontmatterBlock)?.[1]?.trim();
  return { body, frontmatter: { title: parsed.title, description: parsed.description, version, updatedAt } };
}

function splitSections(body: string): AlgorithmsConceptSection[] {
  const matches = [...body.matchAll(/^## (.+)$/gm)];
  return matches.map((match, i) => {
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
    return {
      title: match[1].trim(),
      content: body.slice(contentStart, contentEnd).trim(),
    };
  });
}

@Injectable()
export class AlgorithmsConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[])
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(lang: Language = DEFAULT_LANGUAGE): AlgorithmsConceptSummary[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(slug: string, lang: Language = DEFAULT_LANGUAGE): AlgorithmsConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(lang: Language = DEFAULT_LANGUAGE): AlgorithmsConceptDetail[] {
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

  private readSummary(meta: ConceptMeta, lang: Language): AlgorithmsConceptSummary {
    const { path, language } = this.resolveContentPath(meta.slug, lang);
    const { frontmatter } = parseFrontmatter(readFileSync(path, 'utf-8'));

    return {
      slug: meta.slug,
      id: meta.id,
      category: meta.category,
      title: frontmatter.title ?? meta.title,
      summary: frontmatter.description ?? meta.summary,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages: readAvailableLanguages(meta.slug),
    };
  }

  private readDetail(meta: ConceptMeta, lang: Language): AlgorithmsConceptDetail {
    const { path, language } = this.resolveContentPath(meta.slug, lang);
    const raw = readFileSync(path, 'utf-8');
    const { body, frontmatter } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      category: meta.category,
      title: frontmatter.title ?? meta.title,
      summary: frontmatter.description ?? meta.summary,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages: readAvailableLanguages(meta.slug),
      version: frontmatter.version != null ? String(frontmatter.version) : null,
      updatedAt: frontmatter.updatedAt != null ? String(frontmatter.updatedAt) : null,
      sections: splitSections(body),
      references: meta.references,
    };
  }
}
