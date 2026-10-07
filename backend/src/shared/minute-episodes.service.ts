import { join } from 'path';
import {
  readConceptContent,
  splitSections,
  ConceptSection,
} from './concept-content';
import { ConceptReference } from './concept-types';
import { sortByPrerequisites } from './concept-order';
import {
  DEFAULT_LANGUAGE,
  Language,
  normalizeLanguage,
} from './language';

export interface MinuteEpisodeSummary {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
  language: Language;
  availableLanguages: Language[];
}

export interface MinuteEpisodeDetail extends MinuteEpisodeSummary {
  version: string | null;
  updatedAt: string | null;
  sections: ConceptSection[];
  references: ConceptReference[];
}

interface EpisodeMeta {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
  references: ConceptReference[];
  /** Slugs (within this same track) that should be understood first — see `../shared/concept-order`. */
  requires?: string[];
}

const FRONTMATTER_FIELDS = ['question', 'version', 'updatedAt'] as const;

/**
 * The "minute" tracks (Java Minute, C# Minute): short question-and-answer episodes read
 * from `<dataDir>/episodes.json` plus one markdown file per language under
 * `<dataDir>/content/<slug>/`. A concrete track only passes its data directory.
 */
export abstract class MinuteEpisodesServiceBase {
  private readonly episodesMeta: EpisodeMeta[];

  protected constructor(private readonly dataDir: string) {
    this.episodesMeta = sortByPrerequisites(
      require(join(dataDir, 'episodes.json')) as EpisodeMeta[],
    );
  }

  findAll(lang: Language = DEFAULT_LANGUAGE): MinuteEpisodeSummary[] {
    const language = normalizeLanguage(lang);
    return this.episodesMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(
    slug: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): MinuteEpisodeDetail | null {
    const meta = this.episodesMeta.find((episode) => episode.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(
    lang: Language = DEFAULT_LANGUAGE,
  ): MinuteEpisodeDetail[] {
    const language = normalizeLanguage(lang);
    return this.episodesMeta.map((meta) => this.readDetail(meta, language));
  }

  private readSummary(
    meta: EpisodeMeta,
    lang: Language,
  ): MinuteEpisodeSummary {
    const { language, availableLanguages, question } = readConceptContent(
      this.dataDir,
      meta.slug,
      lang,
      FRONTMATTER_FIELDS,
    );

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

  private readDetail(
    meta: EpisodeMeta,
    lang: Language,
  ): MinuteEpisodeDetail {
    const { language, availableLanguages, body, question, version, updatedAt } =
      readConceptContent(this.dataDir, meta.slug, lang, FRONTMATTER_FIELDS);

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
