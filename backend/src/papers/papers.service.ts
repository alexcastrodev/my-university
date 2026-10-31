import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { PaperInputDto } from './paper.dto';
import { Paper, PaperType } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { PublicationStage, stageOf } from './paper-stage';
import { PaperSource } from './paper-source.entity';
import { normalizeDoi, paperFingerprint } from './paper.normalize';

export interface SourceInfo {
  /** `manual`, `crossref`, ... */
  source: string;
  externalId?: string;
}

export interface PaperView {
  /** The public id: the slug of a public paper, the UUIDv7 of a private one. The integer key is internal. */
  id: string;
  title: string;
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  publicationDate: string | null;
  url: string | null;
  researchArea: string | null;
  type: PaperType;
  /** What the type says about review, in plain terms (see paper-stage.ts). */
  stage: PublicationStage;
  authors: { name: string; orcid: string | null }[];
  keywords: string[];
}

/** The input after trimming and normalizing. `null` means the source did not say. */
interface Clean {
  title: string;
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  publicationDate: string | null;
  url: string | null;
  researchArea: string | null;
  type: PaperType | null;
  authors: { name: string; orcid: string | null }[] | null;
  keywords: string[] | null;
}

/** The first key of the advisory lock readers take while adding a paper; the second is the reader's id. */
const ADD_LOCK = 212;

const text = (value?: string): string | null => value?.trim() || null;

/**
 * The rows of a reader's own private papers (#203, #212). The public papers are files (see
 * papers-catalog.service.ts), so nothing here writes to or reads from the public listing.
 */
@Injectable()
export class PapersService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /**
   * A paper a reader brings in by DOI, by hand or by PDF. It is theirs alone: nothing here touches another
   * reader's papers. `created` is false when they already have it (the same DOI, or the same fingerprint when
   * the DOI is missing on either side), and nothing is changed then.
   */
  addPrivate(
    userId: number,
    input: PaperInputDto,
    source: SourceInfo,
  ): Promise<{ id: number; publicId: string; created: boolean }> {
    const clean = this.clean(input);
    const fingerprint = paperFingerprint(
      clean.title,
      clean.publicationDate,
      clean.authors?.[0]?.name,
    );
    return this.dataSource.transaction(async (m) => {
      // No unique index covers private papers, so adds by one reader take turns: two at once cannot both miss the other.
      await m.query('SELECT pg_advisory_xact_lock($1, $2)', [ADD_LOCK, userId]);
      const own = await this.findDuplicate(m, clean.doi, fingerprint, userId);
      if (own) return { id: own.id, publicId: own.publicId, created: false };
      const paper = await this.insert(m, clean, fingerprint, userId, source, input);
      return { id: paper.id, publicId: paper.publicId, created: true };
    });
  }

  /** The record of one of the reader's own papers, or 404. */
  async getOwn(userId: number, id: number): Promise<PaperView> {
    const paper = await this.dataSource.manager.findOne(Paper, {
      where: { id, ownerId: userId },
    });
    if (!paper) throw new NotFoundException();
    return this.view(this.dataSource.manager, paper);
  }

  private clean(input: PaperInputDto): Clean {
    const rawDoi = text(input.doi);
    const doi = rawDoi ? normalizeDoi(rawDoi) : null;
    if (rawDoi && !doi) throw new BadRequestException('Invalid DOI');
    return {
      title: input.title.trim(),
      abstract: text(input.abstract),
      doi,
      venue: text(input.venue),
      publicationDate: text(input.publicationDate),
      url: text(input.url),
      researchArea: text(input.researchArea),
      type: input.type ?? null,
      authors: input.authors
        ? input.authors
            .map((a) => ({ name: a.name.trim(), orcid: a.orcid ?? null }))
            .filter((a) => a.name)
        : null,
      keywords: input.keywords
        ? [
            ...new Set(
              input.keywords
                .map((k) => k.trim().replace(/\s+/g, ' ').toLowerCase())
                .filter(Boolean),
            ),
          ]
        : null,
    };
  }

  /** A new paper with its authors, keywords and provenance; the reader's id. */
  private async insert(
    m: EntityManager,
    clean: Clean,
    fingerprint: string,
    ownerId: number,
    source: SourceInfo,
    raw: PaperInputDto,
  ): Promise<Paper> {
    if (!clean.doi && !clean.publicationDate && !clean.authors?.length) {
      throw new BadRequestException(
        'A paper without a DOI needs a publication date or at least one author to be told apart from others',
      );
    }
    const paper = await m.save(
      m.create(Paper, {
        title: clean.title,
        abstract: clean.abstract,
        doi: clean.doi,
        fingerprint,
        venue: clean.venue,
        publicationDate: clean.publicationDate,
        url: clean.url,
        researchArea: clean.researchArea,
        type: clean.type ?? 'other',
        ownerId,
      }),
    );
    await this.replaceAuthors(m, paper.id, clean.authors ?? []);
    await this.addKeywords(m, paper.id, clean.keywords ?? []);
    await this.recordSource(m, paper.id, source, raw);
    return paper;
  }

  /**
   * By DOI first. Otherwise by fingerprint: a record that has a DOI is a different paper from one with
   * another DOI (a preprint and its published version), so a new DOI only matches DOI-less records,
   * while a record without DOI matches any. The oldest wins when several match.
   */
  private findDuplicate(
    m: EntityManager,
    doi: string | null,
    fingerprint: string,
    ownerId: number,
  ) {
    // One reader's papers only: one reader's never merges into another's.
    const owner = { ownerId };
    return doi
      ? m.findOne(Paper, { where: { doi, ...owner } }).then(
          (byDoi) =>
            byDoi ??
            m.findOne(Paper, {
              where: { fingerprint, doi: IsNull(), ...owner },
              order: { id: 'ASC' },
            }),
        )
      : m.findOne(Paper, {
          where: { fingerprint, ...owner },
          order: { id: 'ASC' },
        });
  }

  private async replaceAuthors(
    m: EntityManager,
    paperId: number,
    authors: { name: string; orcid: string | null }[],
  ) {
    await m.delete(PaperAuthor, { paperId });
    if (authors.length) {
      await m.insert(
        PaperAuthor,
        authors.map((a, position) => ({
          paperId,
          position,
          name: a.name,
          orcid: a.orcid,
        })),
      );
    }
  }

  private async addKeywords(
    m: EntityManager,
    paperId: number,
    keywords: string[],
  ) {
    if (!keywords.length) return;
    await m
      .createQueryBuilder()
      .insert()
      .into(PaperKeyword)
      .values(keywords.map((keyword) => ({ paperId, keyword })))
      .orIgnore()
      .execute();
  }

  private recordSource(
    m: EntityManager,
    paperId: number,
    source: SourceInfo,
    payload: PaperInputDto,
  ) {
    return m.save(
      m.create(PaperSource, {
        paperId,
        source: source.source,
        externalId: source.externalId ?? null,
        payload: payload as unknown as Record<string, unknown>,
        conflicts: [],
      }),
    );
  }

  private async view(m: EntityManager, paper: Paper): Promise<PaperView> {
    const [authors, keywords] = await Promise.all([
      m.find(PaperAuthor, {
        where: { paperId: paper.id },
        order: { position: 'ASC' },
      }),
      m.find(PaperKeyword, {
        where: { paperId: paper.id },
        order: { keyword: 'ASC' },
      }),
    ]);
    return {
      id: paper.publicId,
      title: paper.title,
      abstract: paper.abstract,
      doi: paper.doi,
      venue: paper.venue,
      publicationDate: paper.publicationDate,
      url: paper.url,
      researchArea: paper.researchArea,
      type: paper.type,
      stage: stageOf(paper.type),
      authors: authors.map((a) => ({ name: a.name, orcid: a.orcid })),
      keywords: keywords.map((k) => k.keyword),
    };
  }
}
