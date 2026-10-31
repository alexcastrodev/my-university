import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ConceptSection, readConceptContent, splitSections } from '../shared/concept-content';
import { DEFAULT_LANGUAGE, Language, SUPPORTED_LANGUAGES, normalizeLanguage } from '../shared/language';
import { toPlainText } from '../shared/plain-text';
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
  /** The title the authors published, when `title` is our translation of it; null otherwise (and for a private paper). */
  originalTitle: string | null;
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

/** One paper in one language, as the search index holds it (`alt*`: the English original a translation changed). */
export interface PaperSearchDocument {
  /** `<slug>_<language>`. */
  id: string;
  slug: string;
  language: Language;
  title: string;
  altTitle: string | null;
  authors: string[];
  doi: string | null;
  keywords: string[];
  altKeywords: string[];
  researchArea: string | null;
  altResearchArea: string | null;
  /** Our one line about the paper. */
  summary: string | null;
  abstract: string | null;
  altAbstract: string | null;
  /** The Research Analysis as plain text. */
  content: string;
}

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
  /** The title the authors published, when `title` is our translation of it. */
  originalTitle: string | null;
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
}

/**
 * What the markdown of one language says about the paper itself, apart from the analysis: the area and the
 * keywords in the frontmatter (`keywords` comma separated), and the authors' abstract as the `## Abstract`
 * (in Portuguese `## Resumo`) section. Both are optional, and English is the fallback for each.
 */
const ABSTRACT_TITLES = ['Abstract', 'Resumo'];

interface PaperTexts {
  abstract: string | null;
  researchArea: string | null;
  /** As written in the file; `keywordsOf` normalises them. */
  keywords: string[];
  /** The Research Analysis: the sections of the file, without the abstract. */
  sections: ConceptSection[];
}

const FRONTMATTER_FIELDS = ['title', 'summary', 'version', 'updatedAt', 'researchArea', 'keywords'] as const;
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

  /**
   * The page of papers that pass every filter. `ranked` is what the search index (papers-search.ts) found
   * for `q`, best first: then `q` matches exactly those papers. Null when there is no index to ask, and then
   * `q` is the plain match of paper-filter.ts. Without a `sort`, a search is in the index's order and a list
   * without a search is newest first.
   */
  list(query: PaperListQueryDto, ranked: string[] | null = null): PaperPage {
    const lang = normalizeLanguage(query.lang);
    const page = query.page ?? 1;
    const limit = query.limit ?? PAPER_PAGE_DEFAULT_LIMIT;
    const { q, ...filters } = query;
    const rank = new Map((ranked ?? []).map((slug, i) => [slug, i]));
    const byRank = (a: PaperSummary, b: PaperSummary) => rank.get(a.id)! - rank.get(b.id)!;
    const found = this.metas
      .map((meta) => this.load(meta, lang))
      .filter((held) => {
        const paper = searchableOf(held);
        return matchesFilter(paper, filters) && (ranked ? rank.has(held.summary.id) : matchesFilter(paper, { q }));
      })
      .map((held) => held.summary)
      .sort(query.sort === 'title' ? byTitle : query.sort === 'recent' || !q || !ranked ? byRecent : byRank);
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
      areas: count(this.metas.map((m) => this.texts(m.slug, lang).researchArea ?? undefined)),
      types: count(this.metas.map((m) => m.type)),
    };
  }

  /** One public paper with its analysis, in the language asked (English when it has no translation). */
  detail(slug: string, lang: Language = DEFAULT_LANGUAGE): PublicPaperView {
    const meta = this.bySlug.get(slug);
    if (!meta) throw new NotFoundException();
    // The folder is named by the file's own slug, never by the one in the request.
    const texts = this.texts(meta.slug, normalizeLanguage(lang));
    const { language, availableLanguages, summary, version, updatedAt, title } = texts.file;
    return {
      id: meta.slug,
      title: title ?? meta.title,
      originalTitle: translatedTitle(title, meta.title),
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
      sections: texts.sections,
    };
  }

  /**
   * What the search index holds: every paper in every language, with the English original of each text a
   * translation changes, so a search typed in either language finds it.
   */
  searchDocuments(): PaperSearchDocument[] {
    return this.metas.flatMap((meta) =>
      SUPPORTED_LANGUAGES.map((lang) => {
        const view = this.detail(meta.slug, lang);
        const { original } = this.texts(meta.slug, lang);
        const other = <T>(mine: T, en: T | undefined) =>
          en !== undefined && JSON.stringify(en) !== JSON.stringify(mine) ? en : null;
        return {
          id: `${meta.slug}_${lang}`,
          slug: meta.slug,
          language: lang,
          title: view.title,
          altTitle: other(view.title, meta.title),
          authors: view.authors.map((a) => a.name),
          doi: view.doi,
          keywords: view.keywords,
          altKeywords: other(view.keywords, original?.keywords) ?? [],
          researchArea: view.researchArea,
          altResearchArea: other(view.researchArea, original?.researchArea ?? undefined),
          summary: view.summary,
          abstract: view.abstract,
          altAbstract: other(view.abstract, original?.abstract ?? undefined),
          content: toPlainText(view.sections.map((s) => `${s.title}\n${s.content}`).join('\n')),
        };
      }),
    );
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
        originalTitle: null,
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

  /**
   * The texts of the file of this language, and, for a translation, the English ones that fill what it leaves
   * out and that a filter or a search also matches.
   *
   * ponytail: the sections are split on every call (a few KB each); memoize by slug and language if the
   * catalog grows to hundreds of papers.
   */
  private texts(slug: string, lang: Language) {
    const file = this.content(slug, lang);
    const mine = textsIn(file);
    if (file.language === DEFAULT_LANGUAGE) {
      return { ...mine, file, keywords: keywordsOf(mine.keywords), abstractTranslated: false, original: undefined };
    }
    const en = textsIn(this.content(slug, DEFAULT_LANGUAGE));
    return {
      file,
      sections: mine.sections,
      abstract: mine.abstract ?? en.abstract,
      abstractTranslated: !!mine.abstract && !!en.abstract,
      researchArea: mine.researchArea ?? en.researchArea,
      keywords: keywordsOf(mine.keywords.length ? mine.keywords : en.keywords),
      original: { abstract: en.abstract, keywords: keywordsOf(en.keywords), researchArea: en.researchArea },
    };
  }

  private load(meta: PaperMeta, lang: Language): HeldPaper {
    const texts = this.texts(meta.slug, lang);
    const { title } = texts.file;
    return {
      abstract: texts.abstract,
      original: texts.original && { ...texts.original, title: meta.title },
      summary: {
        id: meta.slug,
        title: title ?? meta.title,
        originalTitle: translatedTitle(title, meta.title),
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

/** The published title, when the file of this language gives a different (translated) one. */
const translatedTitle = (shown: string | null | undefined, published: string): string | null => (shown && shown !== published ? published : null);

/** Lowercase and unique, as the rows of a private paper keep them. */
const keywordsOf = (keywords: string[]): string[] => [
  ...new Set(keywords.map((k) => k.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)),
];

/** The paper's own texts in a file: the abstract section, the area and keywords of the frontmatter, and the rest. */
function textsIn(file: { body: string; researchArea: string | null; keywords: string | null }): PaperTexts {
  const all = splitSections(file.body);
  return {
    abstract: all.find((s) => ABSTRACT_TITLES.includes(s.title))?.content || null,
    researchArea: file.researchArea,
    keywords: file.keywords ? file.keywords.split(',') : [],
    sections: all.filter((s) => !ABSTRACT_TITLES.includes(s.title)),
  };
}
