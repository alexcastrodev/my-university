import { Injectable } from '@nestjs/common';
import { join } from 'path';
import {
  readConceptContent,
  splitLabSection,
  ConceptSection,
} from '../shared/concept-content';
import { ConceptLinkRef } from '../shared/concept-types';

/** Like `ConceptReference`, but this track also cites books and papers (the same widening system-design uses). */
export interface GoConceptReference {
  label: string;
  url: string;
  type: 'doc' | 'book' | 'paper' | 'video';
}
import { sortByPrerequisites } from '../shared/concept-order';
import {
  DEFAULT_LANGUAGE,
  Language,
  normalizeLanguage,
} from '../shared/language';

export interface GoConceptSummary {
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

export interface GoConceptDetail extends GoConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: ConceptSection[];
  /** Markdown of the `## Lab` section, kept out of `sections` so it only shows in the Lab tab. */
  lab?: string;
  references: GoConceptReference[];
  related: ConceptLinkRef[];
}

interface ConceptMeta extends GoConceptSummary {
  /** Slugs (within this same track) that should be understood first, see `../shared/concept-order`. */
  requires?: string[];
  references: GoConceptReference[];
  related: ConceptLinkRef[];
}

const DATA_DIR = join(__dirname, '../seed/data/go-concepts');
const FRONTMATTER_FIELDS = [
  'title',
  'summary',
  'version',
  'updatedAt',
] as const;

@Injectable()
export class GoConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = sortByPrerequisites(
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[],
  );

  findAll(lang: Language = DEFAULT_LANGUAGE): GoConceptSummary[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readSummary(meta, language));
  }

  findBySlug(
    slug: string,
    lang: Language = DEFAULT_LANGUAGE,
  ): GoConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta, normalizeLanguage(lang));
  }

  findAllDetailed(lang: Language = DEFAULT_LANGUAGE): GoConceptDetail[] {
    const language = normalizeLanguage(lang);
    return this.conceptsMeta.map((meta) => this.readDetail(meta, language));
  }

  private readSummary(meta: ConceptMeta, lang: Language): GoConceptSummary {
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

  private readDetail(meta: ConceptMeta, lang: Language): GoConceptDetail {
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
      ...splitLabSection(body),
      references: meta.references,
      related: meta.related,
    };
  }
}
