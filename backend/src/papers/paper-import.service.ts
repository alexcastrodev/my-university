import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CrossrefClient, ProviderRecord } from './crossref.client';
import { PaperInputDto } from './paper.dto';
import { Paper } from './paper.entity';
import { normalizeDoi } from './paper.normalize';
import { LibraryEntryView, PaperLibraryService } from './paper-library.service';
import { maxPrivatePapers } from './paper-private-limit';
import { PaperRef, publicIdOf } from './paper-ref';
import { PapersCatalogService } from './papers-catalog.service';
import { PapersService } from './papers.service';
import { Throttle } from './throttle';

/** The paper a DOI already is for this reader. */
export interface ImportMatch {
  /** The public id: the slug of the catalog paper, or the UUIDv7 of the reader's own. */
  paperId: string;
  title: string;
  /** True for one of the reader's own papers; false for a catalog paper, which adding uses instead of copying. */
  private: boolean;
  inLibrary: boolean;
}

export interface ImportPreview {
  /** The DOI as it will be stored: lowercase, without a resolver prefix. */
  doi: string;
  source: { name: 'crossref'; retrievedAt: Date };
  /** What the provider says, mapped to the paper model. */
  candidate: PaperInputDto;
  /** What adding this DOI would reuse instead of creating; null when it would create a new private paper. */
  match: ImportMatch | null;
}

export interface AddResult {
  /** The public id of the paper now in the library. */
  paperId: string;
  /** True for a paper only this reader has. */
  private: boolean;
  /** True when the DOI was a catalog paper and that one was used instead of creating a record. */
  matched: boolean;
  /** True when the paper was not in the library yet. */
  created: boolean;
  library: LibraryEntryView;
}

const WINDOW_MS = 10 * 60_000;

/**
 * How a signed-in reader adds a paper to their own library (#212): from a DOI (the metadata is fetched on the
 * server, never taken from the client) or by hand. Nothing here writes to the public catalog and nothing merges
 * into another record: a DOI that is a catalog paper puts that paper in the library, and anything else becomes
 * a private paper only this reader can reach.
 */
@Injectable()
export class PaperImportService {
  private readonly lookups = new Throttle(20, WINDOW_MS);
  private readonly creations = new Throttle(20, WINDOW_MS);

  constructor(
    @Inject(PapersService) private readonly papers: PapersService,
    @Inject(PaperLibraryService) private readonly library: PaperLibraryService,
    @Inject(PapersCatalogService)
    private readonly catalog: PapersCatalogService,
    @Inject(CrossrefClient) private readonly crossref: CrossrefClient,
    @Inject(DataSource) private readonly dataSource: DataSource,
  ) {}

  async preview(userId: number, rawDoi: string): Promise<ImportPreview> {
    const record = await this.fetch(userId, rawDoi);
    const known = await this.known(userId, record.input.doi!);
    return {
      doi: record.input.doi!,
      source: { name: 'crossref', retrievedAt: record.retrievedAt },
      candidate: record.input,
      match: known && {
        paperId: publicIdOf(known.ref),
        title: known.title,
        private: known.ref.kind === 'private',
        inLibrary: await this.library.has(userId, known.ref),
      },
    };
  }

  /** Adds the paper for a DOI to the library, recording Crossref and the DOI as its provenance. */
  async import(userId: number, rawDoi: string): Promise<AddResult> {
    const record = await this.fetch(userId, rawDoi);
    const known = await this.known(userId, record.input.doi!);
    if (known) return this.place(userId, known.ref);
    return this.addNew(userId, record.input, {
      source: 'crossref',
      externalId: record.externalId,
    });
  }

  /** A paper typed in by hand, for a DOI the provider does not know or when the provider is down. */
  async createManual(userId: number, input: PaperInputDto): Promise<AddResult> {
    this.limit(this.creations.hit(userId));
    const doi = input.doi?.trim() ? normalizeDoi(input.doi) : null;
    if (input.doi?.trim() && !doi) {
      throw new BadRequestException('Invalid DOI');
    }
    const slug = doi ? this.catalog.slugOfDoi(doi) : null;
    if (slug) return this.place(userId, { kind: 'public', slug });
    return this.addNew(userId, input, { source: 'manual' }, true);
  }

  /** The paper this DOI is for the reader: the catalog's first (it is shared, so never copied), else their own. */
  private async known(
    userId: number,
    doi: string,
  ): Promise<{ ref: PaperRef; title: string } | null> {
    const slug = this.catalog.slugOfDoi(doi);
    if (slug) {
      return { ref: { kind: 'public', slug }, title: this.catalog.titleOf(slug) };
    }
    const own = await this.dataSource.getRepository(Paper).findOne({
      where: { doi, ownerId: userId },
      select: { id: true, publicId: true, title: true },
    });
    return own && { ref: { kind: 'private', id: own.id, publicId: own.publicId }, title: own.title };
  }

  private async place(userId: number, ref: PaperRef): Promise<AddResult> {
    const { entry, created } = await this.library.addRef(userId, ref);
    return {
      paperId: publicIdOf(ref),
      private: ref.kind === 'private',
      matched: ref.kind === 'public',
      created,
      library: entry,
    };
  }

  /** A new private paper, in the library. By hand, one the reader already has is refused instead of repeated. */
  private async addNew(
    userId: number,
    input: PaperInputDto,
    source: { source: string; externalId?: string },
    refuseOwn = false,
  ): Promise<AddResult> {
    // ponytail: count then insert, so two parallel adds can overshoot the cap by one; a lock when it matters.
    const max = maxPrivatePapers();
    const count = await this.dataSource
      .getRepository(Paper)
      .count({ where: { ownerId: userId } });
    if (count >= max) {
      throw new ConflictException({
        statusCode: 409,
        code: 'private_papers_limit',
        message: `You can keep up to ${max} papers of your own. Delete one to add another.`,
      });
    }
    const paper = await this.papers.addPrivate(userId, input, source);
    if (!paper.created && refuseOwn) {
      throw new ConflictException({
        statusCode: 409,
        code: 'already_exists',
        message: 'This paper is already in your library',
        paperId: paper.publicId,
      });
    }
    return this.place(userId, {
      kind: 'private',
      id: paper.id,
      publicId: paper.publicId,
    });
  }

  private async fetch(userId: number, rawDoi: string): Promise<ProviderRecord> {
    const doi = normalizeDoi(rawDoi);
    // A `..` segment would climb out of `/works/` on the provider's host: never a DOI.
    if (!doi || doi.split('/').some((part) => part === '.' || part === '..')) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'invalid_doi',
        message: 'That is not a DOI. It looks like 10.1234/abc, or https://doi.org/10.1234/abc',
      });
    }
    this.limit(this.lookups.hit(userId));
    return this.crossref.lookup(doi);
  }

  private limit(retryAfter: number | null): void {
    if (retryAfter === null) return;
    throw new HttpException(
      {
        statusCode: 429,
        code: 'too_many_requests',
        message: 'Too many lookups, try again in a few minutes',
        retryAfter,
      },
      429,
    );
  }
}
