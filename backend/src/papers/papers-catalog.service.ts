import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ConceptSection, readConceptContent, splitSections } from '../shared/concept-content';
import { DEFAULT_LANGUAGE, Language, SUPPORTED_LANGUAGES, normalizeLanguage } from '../shared/language';
import { PAPER_TYPES, Paper, PaperType } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { byRecent, byTitle, matchesFilter, Searchable } from './paper-filter';
import { PaperKeyword } from './paper-keyword.entity';
import { isPaperSlug } from './paper-ref';
import { PAPER_PAGE_DEFAULT_LIMIT, PaperListQueryDto } from './paper-query.dto';
import { PublicationStage, stageOf } from './paper-stage';
import { normalizeDoi } from './paper.normalize';
import type { PaperView } from './papers.service';

/** What a catalog row shows; the full record (whole abstract, ORCIDs) is one request away. */
export interface PaperSummary {
  /** What URLs and the API call the paper: the slug of a public one, the UUIDv7 of a private one. */
  id: string;
  title: string;
  authors: string[];
  keywords: string[];
  venue: string | null;
  publicationDate: string | null;
  doi: string | null;
  /** The paper's own page at the publisher or the archive, for the link on a list row. */
  url: string | null;
  researchArea: string | null;
  type: PaperType;
  /** What the type says about review, in plain terms (see paper-stage.ts). */
  stage: PublicationStage;
  /** The start of the abstract, or null when the paper has none. */
  excerpt: string | null;
}

/** A summary together with what a search needs and the row's summary does not carry. */
export interface HeldPaper {
  summary: PaperSummary;
  abstract: string | null;
  /** The English original of the texts shown translated, so a search in either language finds the paper. */
  original?: Searchable['original'];
}

export const searchableOf = ({ summary, abstract, original }: HeldPaper): Searchable => ({
  original,
  title: summary.title,
  abstract,
  doi: summary.doi,
  authors: summary.authors,
  keywords: summary.keywords,
  researchArea: summary.researchArea,
  type: summary.type,
  publicationDate: summary.publicationDate,
});

export interface PaperPage {
  items: PaperSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface PaperFacets {
  areas: FacetValue[];
  types: FacetValue[];
}

/** The record of a public paper, with our analysis of it (never the authors' words). */
export interface PublicPaperView extends PaperView {
  language: Language;
  availableLanguages: Language[];
  /** One line from us about the paper; not the abstract, which is the authors'. */
  summary: string | null;
  /** True when the abstract above is our translation of the authors' English one. */
  abstractTranslated: boolean;
  version: string | null;
  /** The day the analysis was last revised (`YYYY-MM-DD`). */
  updatedAt: string | null;
  /** The Research Analysis: the `## ` sections of the markdown, in the order they are written. */
  sections: ConceptSection[];
}

/** One entry of `papers.json`. Everything but the slug, title, authors and type is optional. */
interface PaperMeta {
  slug: string;
  title: string;
  authors: { name: string; orcid?: string }[];
  type: PaperType;
  venue?: string;
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. */
  publicationDate?: string;
  doi?: string;
  url?: string;
  researchArea?: string;
  keywords?: string[];
  /** The authors' abstract, only where the publisher lets it be reproduced. */
  abstract?: string;
  /** What reads differently in another language; the fields above are the English original and the fallback. */
  i18n?: Partial<Record<Language, PaperTranslation>>;
}

/** The texts of a paper that are translated: the title and the venue stay as published. */
interface PaperTranslation {
  researchArea?: string;
  /** One for each English keyword, in the same order. */
  keywords?: string[];
  /** Our translation of `abstract`, so it exists only where the abstract does. */
  abstract?: string;
}

/** The texts of a paper in one language, English wherever there is no translation. */
function textsOf(meta: PaperMeta, lang: Language) {
  const t = lang === DEFAULT_LANGUAGE ? undefined : meta.i18n?.[lang];
  return {
    abstract: t?.abstract ?? meta.abstract ?? null,
    abstractTranslated: !!t?.abstract,
    researchArea: t?.researchArea ?? meta.researchArea ?? null,
    keywords: keywordsOf({ ...meta, keywords: t?.keywords ?? meta.keywords }),
    translated: !!t,
  };
}

const FRONTMATTER_FIELDS = ['title', 'summary', 'version', 'updatedAt'] as const;
const EXCERPT_CHARS = 280;
const FACET_LIMIT = 50;
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function excerptOf(abstract: string | null): string | null {
  const text = abstract?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`;
}

/** Where the files are. `PAPERS_DATA_DIR` points a test at its own fixtures. */
const dataDir = () =>
  process.env.PAPERS_DATA_DIR ?? join(__dirname, '../seed/data/papers');

/** Reads and checks `papers.json`; a mistake in the files stops the boot with a message that names it. */
function loadIndex(dir: string): PaperMeta[] {
  const file = join(dir, 'papers.json');
  const metas = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : []) as PaperMeta[];
  const seen = new Set<string>();
  const dois = new Set<string>();
  for (const meta of metas) {
    const at = `papers.json, ${meta.slug ?? '(no slug)'}`;
    const fail = (why: string): never => {
      throw new Error(`${at}: ${why}`);
    };
    if (!isPaperSlug(meta.slug)) fail('the slug is lowercase words joined by hyphens');
    if (seen.has(meta.slug)) fail('the slug is used twice');
    seen.add(meta.slug);
    if (typeof meta.title !== 'string' || !meta.title.trim()) fail('a title is required');
    if (!PAPER_TYPES.includes(meta.type)) fail(`type is one of ${PAPER_TYPES.join(', ')}`);
    if (!Array.isArray(meta.authors) || !meta.authors.length || meta.authors.some((a) => !a?.name?.trim())) {
      fail('at least one author, each with a name');
    }
    if (meta.publicationDate !== undefined && !DATE.test(meta.publicationDate)) {
      fail('publicationDate is YYYY, YYYY-MM or YYYY-MM-DD');
    }
    if (meta.doi !== undefined) {
      if (normalizeDoi(meta.doi) !== meta.doi) fail('doi is lowercase, without a resolver prefix');
      if (dois.has(meta.doi)) fail('the DOI is used twice');
      dois.add(meta.doi);
    }
    if (meta.url !== undefined && !/^https?:\/\//.test(meta.url)) fail('url is http or https');
    for (const [lang, t] of Object.entries(meta.i18n ?? {})) {
      if (lang === DEFAULT_LANGUAGE || !SUPPORTED_LANGUAGES.includes(lang as Language)) {
        fail(`i18n is keyed by a supported language other than ${DEFAULT_LANGUAGE}`);
      }
      if (t.researchArea !== undefined && !meta.researchArea) fail(`i18n ${lang}: researchArea has nothing to translate`);
      if (t.abstract !== undefined && !meta.abstract) fail(`i18n ${lang}: abstract has nothing to translate`);
      if (t.keywords !== undefined && t.keywords.length !== (meta.keywords ?? []).length) {
        fail(`i18n ${lang}: one keyword for each English keyword`);
      }
    }
    if (!existsSync(join(dir, 'content', meta.slug, `${DEFAULT_LANGUAGE}.md`))) {
      fail(`content/${meta.slug}/en.md is missing`);
    }
  }
  return metas;
}

/**
 * The public papers: authored files, reviewed like a concept (#213). `papers.json` is the index and
 * `content/<slug>/en.md` and `pt-BR.md` carry the analysis, with the `version` and `updatedAt` frontmatter. A
 * reader or a curator writes nothing here, and there is no table behind it: adding, editing or removing a
 * paper is a change to the files.
 *
 * Also the read side for the rows of a reader's private papers (`heldRows`), so both kinds of paper answer in
 * the same shape. Provenance (`paper_source`) is not selected anywhere in here, so it cannot leak by accident.
 */
@Injectable()
export class PapersCatalogService {
  private readonly dir = dataDir();
  private readonly metas = loadIndex(this.dir);
  private readonly bySlug = new Map(this.metas.map((m) => [m.slug, m]));

  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  has(slug: string): boolean {
    return this.bySlug.has(slug);
  }

  /** The slug of the public paper with this DOI, if there is one. */
  slugOfDoi(doi: string): string | null {
    return this.metas.find((m) => m.doi === doi)?.slug ?? null;
  }

  /** The title of a public paper, or 404: what a discussion or a notification shows for it. */
  titleOf(slug: string, lang: Language = DEFAULT_LANGUAGE): string {
    const held = this.held(slug, lang);
    if (!held) throw new NotFoundException();
    return held.summary.title;
  }

  /** Every public paper's slug with the day its analysis was last revised, for the sitemap. */
  slugs(): { slug: string; updatedAt: string | null; languages: Language[] }[] {
    return this.metas.map((meta) => {
      const { updatedAt, availableLanguages } = this.content(meta.slug, DEFAULT_LANGUAGE);
      return { slug: meta.slug, updatedAt, languages: availableLanguages };
    });
  }

  list(query: PaperListQueryDto): PaperPage {
    const lang = normalizeLanguage(query.lang);
    const page = query.page ?? 1;
    const limit = query.limit ?? PAPER_PAGE_DEFAULT_LIMIT;
    const found = this.metas
      .map((meta) => this.load(meta, lang))
      .filter((held) => matchesFilter(searchableOf(held), query))
      .map((held) => held.summary)
      .sort(query.sort === 'title' ? byTitle : byRecent);
    return {
      items: found.slice((page - 1) * limit, page * limit),
      total: found.length,
      page,
      limit,
    };
  }

  /** The values the filter selects offer, most used first, with the areas in the language asked. */
  facets(lang: Language = DEFAULT_LANGUAGE): PaperFacets {
    const count = (values: (string | undefined)[]): FacetValue[] => {
      const counts = new Map<string, number>();
      for (const value of values) {
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts]
        .map(([value, n]) => ({ value, count: n }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, FACET_LIMIT);
    };
    return {
      // A paper without a file in this language is listed in English, so its area is too.
      areas: count(this.metas.map((m) => textsOf(m, this.content(m.slug, lang).language).researchArea ?? undefined)),
      types: count(this.metas.map((m) => m.type)),
    };
  }

  /** One public paper with its analysis, in the language asked (English when it has no translation). */
  detail(slug: string, lang: Language = DEFAULT_LANGUAGE): PublicPaperView {
    const meta = this.bySlug.get(slug);
    if (!meta) throw new NotFoundException();
    // The folder is named by the file's own slug, never by the one in the request.
    const { language, availableLanguages, body, summary, version, updatedAt, title } = this.content(
      meta.slug,
      normalizeLanguage(lang),
    );
    const texts = textsOf(meta, language);
    return {
      id: meta.slug,
      title: title ?? meta.title,
      abstract: texts.abstract,
      abstractTranslated: texts.abstractTranslated,
      doi: meta.doi ?? null,
      venue: meta.venue ?? null,
      publicationDate: meta.publicationDate ?? null,
      url: meta.url ?? null,
      researchArea: texts.researchArea,
      type: meta.type,
      stage: stageOf(meta.type),
      authors: meta.authors.map((a) => ({ name: a.name, orcid: a.orcid ?? null })),
      keywords: texts.keywords,
      language,
      availableLanguages,
      summary,
      version,
      updatedAt,
      sections: splitSections(body),
    };
  }

  /** A public paper as a list row, plus what a search needs; null when there is no such paper. */
  held(slug: string, lang: Language = DEFAULT_LANGUAGE): HeldPaper | null {
    const meta = this.bySlug.get(slug);
    return meta ? this.load(meta, normalizeLanguage(lang)) : null;
  }

  /** The same for a reader's own private papers, from their rows. */
  async heldRows(papers: Paper[]): Promise<HeldPaper[]> {
    const ids = papers.map((p) => p.id);
    const [authors, keywords] = ids.length
      ? await Promise.all([
          this.dataSource
            .getRepository(PaperAuthor)
            .createQueryBuilder('a')
            .where('a.paperId IN (:...ids)', { ids })
            .orderBy('a.position', 'ASC')
            .getMany(),
          this.dataSource
            .getRepository(PaperKeyword)
            .createQueryBuilder('k')
            .where('k.paperId IN (:...ids)', { ids })
            .orderBy('k.keyword', 'ASC')
            .getMany(),
        ])
      : [[], []];

    const by = <T extends { paperId: number }>(rows: T[]) => {
      const map = new Map<number, T[]>();
      for (const row of rows) map.set(row.paperId, [...(map.get(row.paperId) ?? []), row]);
      return map;
    };
    const authorsOf = by(authors);
    const keywordsByPaper = by(keywords);

    return papers.map((p) => ({
      abstract: p.abstract,
      summary: {
        id: p.publicId,
        title: p.title,
        authors: (authorsOf.get(p.id) ?? []).map((a) => a.name),
        keywords: (keywordsByPaper.get(p.id) ?? []).map((k) => k.keyword),
        venue: p.venue,
        publicationDate: p.publicationDate,
        doi: p.doi,
        url: p.url,
        researchArea: p.researchArea,
        type: p.type,
        stage: stageOf(p.type),
        excerpt: excerptOf(p.abstract),
      },
    }));
  }

  private content(slug: string, lang: Language) {
    return readConceptContent(this.dir, slug, lang, FRONTMATTER_FIELDS);
  }

  private load(meta: PaperMeta, lang: Language): HeldPaper {
    const { title, language } = this.content(meta.slug, lang);
    const texts = textsOf(meta, language);
    return {
      abstract: texts.abstract,
      original: texts.translated
        ? { abstract: meta.abstract ?? null, keywords: keywordsOf(meta), researchArea: meta.researchArea ?? null }
        : undefined,
      summary: {
        id: meta.slug,
        title: title ?? meta.title,
        authors: meta.authors.map((a) => a.name),
        keywords: texts.keywords,
        venue: meta.venue ?? null,
        publicationDate: meta.publicationDate ?? null,
        doi: meta.doi ?? null,
        url: meta.url ?? null,
        researchArea: texts.researchArea,
        type: meta.type,
        stage: stageOf(meta.type),
        excerpt: excerptOf(texts.abstract),
      },
    };
  }
}

/** Lowercase and unique, as the rows of a private paper keep them. */
const keywordsOf = (meta: PaperMeta): string[] => [
  ...new Set((meta.keywords ?? []).map((k) => k.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)),
];
