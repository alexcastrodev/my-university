import { Injectable } from '@nestjs/common';
import { join } from 'path';
import {
  readConceptContent,
  splitSections,
  ConceptSection,
} from '../shared/concept-content';
import {
  DEFAULT_LANGUAGE,
  Language,
  normalizeLanguage,
} from '../shared/language';

export interface JavaMinuteReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
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
  sections: ConceptSection[];
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
const FRONTMATTER_FIELDS = ['question', 'version', 'updatedAt'] as const;

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

  findBySlug(
    slug: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): JavaMinuteEpisodeDetail | null {
    const meta = this.episodesMeta.find((episode) => episode.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(
    lang: Language = DEFAULT_LANGUAGE,
  ): JavaMinuteEpisodeDetail[] {
    const language = normalizeLanguage(lang);
    return this.episodesMeta.map((meta) => this.readDetail(meta, language));
  }

  private readSummary(
    meta: EpisodeMeta,
    lang: Language,
  ): JavaMinuteEpisodeSummary {
    const { language, availableLanguages, question } = readConceptContent(
      DATA_DIR,
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
  ): JavaMinuteEpisodeDetail {
    const { language, availableLanguages, body, question, version, updatedAt } =
      readConceptContent(DATA_DIR, meta.slug, lang, FRONTMATTER_FIELDS);

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
