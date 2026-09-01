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

export interface RubyOnRailsConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export type ConceptLinkRef =
  | string
  | { label: string; slug: string; feature?: string };

export interface RubyOnRailsConceptSummary {
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

export interface RubyOnRailsConceptDetail extends RubyOnRailsConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: ConceptSection[];
  references: RubyOnRailsConceptReference[];
  related: ConceptLinkRef[];
}

interface ConceptMeta extends RubyOnRailsConceptSummary {
  references: RubyOnRailsConceptReference[];
  related: ConceptLinkRef[];
}

const DATA_DIR = join(__dirname, '../seed/data/rubyonrails-concepts');
const FRONTMATTER_FIELDS = [
  'title',
  'summary',
  'version',
  'updatedAt',
] as const;

@Injectable()
export class RubyOnRailsConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(lang: Language = DEFAULT_LANGUAGE): RubyOnRailsConceptSummary[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(
    slug: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): RubyOnRailsConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(
    lang: Language = DEFAULT_LANGUAGE,
  ): RubyOnRailsConceptDetail[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readDetail(meta, language));
  }

  private readSummary(
    meta: ConceptMeta,
    lang: Language,
  ): RubyOnRailsConceptSummary {
    const { language, availableLanguages, title, summary } = readConceptContent(
      DATA_DIR,
      meta.slug,
      lang,
      FRONTMATTER_FIELDS,
    );

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

  private readDetail(
    meta: ConceptMeta,
    lang: Language,
  ): RubyOnRailsConceptDetail {
    const {
      language,
      availableLanguages,
      body,
      title,
      summary,
      version,
      updatedAt,
    } = readConceptContent(DATA_DIR, meta.slug, lang, FRONTMATTER_FIELDS);

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
