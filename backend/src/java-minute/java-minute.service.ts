import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LANGUAGE, Language, SUPPORTED_LANGUAGES, normalizeLanguage } from '../shared/language';

export interface JavaMinuteReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JavaMinuteSection {
  title: string;
  content: string;
}

export interface JavaMinuteEpisodeSummary {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
  language: Language;
  availableLanguages: Language[];
}

export interface JavaMinuteEpisodeDetail extends JavaMinuteEpisodeSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JavaMinuteSection[];
  references: JavaMinuteReference[];
}

interface EpisodeMeta {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
  references: JavaMinuteReference[];
}

const DATA_DIR = join(__dirname, '../seed/data/java-minute');

function parseFrontmatter(raw: string): {
  body: string;
  version: string | null;
  updatedAt: string | null;
  question: string | null;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw, version: null, updatedAt: null, question: null };
  const [, frontmatter, body] = match;
  const version = /^version:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  const updatedAt =
    /^updatedAt:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  const question = /^question:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  return { body, version, updatedAt, question };
}

function splitSections(body: string): JavaMinuteSection[] {
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
export class JavaMinuteService {
  private readonly episodesMeta: EpisodeMeta[] = (
    require(join(DATA_DIR, 'episodes.json')) as EpisodeMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(lang: Language = DEFAULT_LANGUAGE): JavaMinuteEpisodeSummary[] {
    const language = normalizeLanguage(lang);
    return this.episodesMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(slug: string, lang: Language = DEFAULT_LANGUAGE): JavaMinuteEpisodeDetail | null {
    const meta = this.episodesMeta.find((episode) => episode.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(lang: Language = DEFAULT_LANGUAGE): JavaMinuteEpisodeDetail[] {
    const language = normalizeLanguage(lang);
    return this.episodesMeta.map((meta) => this.readDetail(meta, language));
  }

  /** Resolves the content file to serve for a slug/language, falling back to English when the translation is missing. */
  private resolveContentPath(slug: string, lang: Language): { path: string; language: Language } {
    const preferred = join(DATA_DIR, 'content', slug, `${lang}.md`);
    if (lang !== DEFAULT_LANGUAGE && existsSync(preferred)) {
      return { path: preferred, language: lang };
    }
    return { path: join(DATA_DIR, 'content', slug, `${DEFAULT_LANGUAGE}.md`), language: DEFAULT_LANGUAGE };
  }

  private readSummary(meta: EpisodeMeta, lang: Language): JavaMinuteEpisodeSummary {
    const availableLanguages = readAvailableLanguages(meta.slug);
    const { path, language } = this.resolveContentPath(meta.slug, lang);
    const { question } = parseFrontmatter(readFileSync(path, 'utf-8'));

    return {
      slug: meta.slug,
      id: meta.id,
      question: question ?? meta.question,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages,
    };
  }

  private readDetail(meta: EpisodeMeta, lang: Language): JavaMinuteEpisodeDetail {
    const availableLanguages = readAvailableLanguages(meta.slug);
    const { path, language } = this.resolveContentPath(meta.slug, lang);
    const raw = readFileSync(path, 'utf-8');
    const { body, version, updatedAt, question } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      question: question ?? meta.question,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages,
      version,
      updatedAt,
      sections: splitSections(body),
      references: meta.references,
    };
  }
}
