import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull, SelectQueryBuilder } from 'typeorm';
import {
  PAPER_PAGE_DEFAULT_LIMIT,
  PaperFilterDto,
  PaperListQueryDto,
} from './paper-query.dto';
import { Paper, PaperType } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { normalizeDoi } from './paper.normalize';
import { isPublicId } from './paper-public-id';
import { PublicationStage, stageOf, typesOfStage } from './paper-stage';

/** What a catalog row shows; the full record (whole abstract, ORCIDs) is one request away. */
export interface PaperSummary {
  /** The public id (UUIDv7); the integer key never leaves the server. */
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

const EXCERPT_CHARS = 280;
const FACET_LIMIT = 50;
const MAX_ID = 2_147_483_647;

/** `%` and `_` are wildcards in LIKE; a reader typing "50%" means the characters. */
const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

function excerptOf(abstract: string | null): string | null {
  const text = abstract?.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`;
}

/**
 * The read side of the catalog: public metadata of public papers only (a private paper, #203, is never listed). Provenance (`paper_source`) is not selected
 * anywhere in here, so it cannot leak by accident.
 *
 * ponytail: ILIKE scans, fine while the catalog is thousands of papers; move to a tsvector index
 * (or Meilisearch, which the concept search already uses) when it is not.
 */
@Injectable()
export class PapersCatalogService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  async list(query: PaperListQueryDto): Promise<PaperPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? PAPER_PAGE_DEFAULT_LIMIT;
    const builder = this.dataSource
      .getRepository(Paper)
      .createQueryBuilder('p')
      .where('p.ownerId IS NULL');
    this.filter(builder, query);

    const total = await builder.getCount();
    if (query.sort === 'title') {
      builder.orderBy('LOWER(p.title)', 'ASC').addOrderBy('p.id', 'ASC');
    } else {
      builder
        .orderBy('p.publicationDate', 'DESC', 'NULLS LAST')
        .addOrderBy('p.id', 'DESC');
    }
    const papers = await builder
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    return {
      items: await this.summaries(papers),
      total,
      page,
      limit,
    };
  }

  /** The catalog rows for these papers, in the same order. */
  async summaries(papers: Paper[]): Promise<PaperSummary[]> {
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
      for (const row of rows)
        map.set(row.paperId, [...(map.get(row.paperId) ?? []), row]);
      return map;
    };
    const authorsOf = by(authors);
    const keywordsOf = by(keywords);

    return papers.map((p) => ({
      id: p.publicId,
      title: p.title,
      authors: (authorsOf.get(p.id) ?? []).map((a) => a.name),
      keywords: (keywordsOf.get(p.id) ?? []).map((k) => k.keyword),
      venue: p.venue,
      publicationDate: p.publicationDate,
      doi: p.doi,
      url: p.url,
      researchArea: p.researchArea,
      type: p.type,
      stage: stageOf(p.type),
      excerpt: excerptOf(p.abstract),
    }));
  }

  /** The values the filter selects offer, most used first. */
  async facets(): Promise<PaperFacets> {
    const group = async (column: string): Promise<FacetValue[]> => {
      const rows: { value: string; count: string }[] = await this.dataSource
        .getRepository(Paper)
        .createQueryBuilder('p')
        .select(`p.${column}`, 'value')
        .addSelect('COUNT(*)', 'count')
        .where(`p.${column} IS NOT NULL AND p.ownerId IS NULL`)
        .groupBy(`p.${column}`)
        .orderBy('COUNT(*)', 'DESC')
        .addOrderBy(`p.${column}`, 'ASC')
        .limit(FACET_LIMIT)
        .getRawMany();
      return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
    };
    const [areas, types] = await Promise.all([
      group('researchArea'),
      group('type'),
    ]);
    return { areas, types };
  }

  /** The title of a paper, or 404: what a discussion or a notification shows for it. */
  async titleOf(id: number): Promise<string> {
    if (!Number.isSafeInteger(id) || id < 1 || id > MAX_ID) {
      throw new NotFoundException();
    }
    const paper = await this.dataSource
      .getRepository(Paper)
      .findOne({
        where: { id, ownerId: IsNull() },
        select: { id: true, title: true },
      });
    if (!paper) throw new NotFoundException();
    return paper.title;
  }

  /** The title of a paper by its public id, or 404: what a discussion or a notification shows for it. */
  async titleOfPublic(publicId: string): Promise<string> {
    if (!isPublicId(publicId)) throw new NotFoundException();
    const paper = await this.dataSource.getRepository(Paper).findOne({
      where: { publicId: publicId.toLowerCase(), ownerId: IsNull() },
      select: { id: true, title: true },
    });
    if (!paper) throw new NotFoundException();
    return paper.title;
  }

  /** Adds the shared filters to a query over `Paper` aliased `p`. */
  filter(builder: SelectQueryBuilder<Paper>, query: PaperFilterDto) {
    const has = (text?: string): text is string => !!text && text.length > 0;

    if (has(query.q)) {
      builder.andWhere(
        `(p.title ILIKE :q OR p.abstract ILIKE :q OR p.doi ILIKE :q
          OR EXISTS (SELECT 1 FROM paper_author a WHERE a."paperId" = p.id AND a.name ILIKE :q)
          OR EXISTS (SELECT 1 FROM paper_keyword k WHERE k."paperId" = p.id AND k.keyword ILIKE :q))`,
        { q: likeOf(query.q) },
      );
    }
    if (has(query.author)) {
      builder.andWhere(
        'EXISTS (SELECT 1 FROM paper_author a WHERE a."paperId" = p.id AND a.name ILIKE :author)',
        { author: likeOf(query.author) },
      );
    }
    if (has(query.doi)) {
      builder.andWhere('p.doi ILIKE :doi', {
        doi: likeOf(normalizeDoi(query.doi) ?? query.doi.toLowerCase()),
      });
    }
    if (has(query.keyword)) {
      builder.andWhere(
        'EXISTS (SELECT 1 FROM paper_keyword k WHERE k."paperId" = p.id AND k.keyword = :keyword)',
        { keyword: query.keyword.toLowerCase() },
      );
    }
    if (has(query.area)) {
      builder.andWhere('LOWER(p.researchArea) = LOWER(:area)', {
        area: query.area,
      });
    }
    if (query.type) builder.andWhere('p.type = :type', { type: query.type });
    if (query.stage) {
      builder.andWhere('p.type IN (:...stageTypes)', {
        stageTypes: typesOfStage(query.stage),
      });
    }
    if (query.year) {
      builder.andWhere('LEFT(p.publicationDate, 4) = :year', {
        year: query.year,
      });
    }
  }
}
