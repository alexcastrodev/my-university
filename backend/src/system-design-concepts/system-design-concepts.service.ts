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

export type SystemDesignConceptDifficulty =
  | 'Beginner'
  | 'Intermediate'
  | 'Advanced';

export interface SystemDesignConceptReference {
  label: string;
  url: string;
  type: 'book' | 'paper' | 'engineering' | 'doc' | 'video';
}

export type SystemDesignConceptLinkFeature = 'system-design' | 'database';

export type SystemDesignConceptLinkRef =
  | string
  | { label: string; slug: string; feature?: SystemDesignConceptLinkFeature };

export interface SystemDesignConceptSummary {
  slug: string;
  id: number;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  difficulty: SystemDesignConceptDifficulty;
  readingTime: number;
  tags: string[];
  prerequisites: SystemDesignConceptLinkRef[];
  related: SystemDesignConceptLinkRef[];
  labUrl?: string;
  language: Language;
  availableLanguages: Language[];
}

export interface SystemDesignConceptDetail extends SystemDesignConceptSummary {
  sections: ConceptSection[];
  references: SystemDesignConceptReference[];
}

interface ConceptMeta extends SystemDesignConceptSummary {
  references: SystemDesignConceptReference[];
}

const DATA_DIR = join(__dirname, '../seed/data/system-design-concepts');
const FRONTMATTER_FIELDS = ['title', 'description'] as const;

@Injectable()
export class SystemDesignConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(lang: Language = DEFAULT_LANGUAGE): SystemDesignConceptSummary[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(
    slug: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): SystemDesignConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(
    lang: Language = DEFAULT_LANGUAGE,
  ): SystemDesignConceptDetail[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readDetail(meta, language));
  }

  private readSummary(
    meta: ConceptMeta,
    lang: Language,
  ): SystemDesignConceptSummary {
    const { language, availableLanguages, title, description } =
      readConceptContent(DATA_DIR, meta.slug, lang, FRONTMATTER_FIELDS);

    return {
      slug: meta.slug,
      id: meta.id,
      title: title ?? meta.title,
      topic: meta.topic,
      summary: description ?? meta.summary,
      publishedAt: meta.publishedAt,
      difficulty: meta.difficulty,
      readingTime: meta.readingTime,
      tags: meta.tags,
      prerequisites: meta.prerequisites,
      related: meta.related,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages,
    };
  }

  private readDetail(
    meta: ConceptMeta,
    lang: Language,
  ): SystemDesignConceptDetail {
    const { language, availableLanguages, body, title, description } =
      readConceptContent(DATA_DIR, meta.slug, lang, FRONTMATTER_FIELDS);

    return {
      slug: meta.slug,
      id: meta.id,
      title: title ?? meta.title,
      topic: meta.topic,
      summary: description ?? meta.summary,
      publishedAt: meta.publishedAt,
      difficulty: meta.difficulty,
      readingTime: meta.readingTime,
      tags: meta.tags,
      prerequisites: meta.prerequisites,
      related: meta.related,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      language,
      availableLanguages,
      sections: splitSections(body),
      references: meta.references,
    };
  }
}
