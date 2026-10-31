import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CrossrefClient, ProviderRecord } from './crossref.client';
import { PaperInputDto } from './paper.dto';
import { normalizeDoi } from './paper.normalize';
import { PapersService, PaperView, UpsertResult } from './papers.service';
import { PaperConflict } from './paper-source.entity';
import { Throttle } from './throttle';

export interface ImportPreview {
  /** The DOI as it will be stored: lowercase, without a resolver prefix. */
  doi: string;
  source: { name: 'crossref'; retrievedAt: Date };
  /** What the provider says, mapped to the paper model. */
  candidate: PaperInputDto;
  /** The paper this would merge into, as it would look after the merge; null when a new paper would be created. */
  match: PaperView | null;
  /** Where the provider disagrees with what is already stored. Imports never overwrite: the stored value stays. */
  conflicts: PaperConflict[];
}

const WINDOW_MS = 10 * 60_000;

/**
 * Lets a signed-in reader bring a paper into the catalog: from a DOI (the metadata is fetched on the server,
 * never taken from the client) or by hand. Nothing here lets them change a paper that already exists: an import
 * only fills what is empty, and a hand-made record that matches an existing paper is refused instead of merged.
 */
@Injectable()
export class PaperImportService {
  private readonly lookups = new Throttle(20, WINDOW_MS);
  private readonly creations = new Throttle(20, WINDOW_MS);

  constructor(
    @Inject(PapersService) private readonly papers: PapersService,
    @Inject(CrossrefClient) private readonly crossref: CrossrefClient,
  ) {}

  async preview(userId: number, rawDoi: string): Promise<ImportPreview> {
    const record = await this.fetch(userId, rawDoi);
    const { match, conflicts } = await this.papers.preview(record.input);
    return {
      doi: record.input.doi!,
      source: { name: 'crossref', retrievedAt: record.retrievedAt },
      candidate: record.input,
      match,
      conflicts,
    };
  }

  /** Imports (or matches) the paper for a DOI, recording Crossref and the DOI as its provenance. */
  async import(userId: number, rawDoi: string): Promise<UpsertResult> {
    const record = await this.fetch(userId, rawDoi);
    return this.papers.upsert(record.input, {
      source: 'crossref',
      externalId: record.externalId,
    });
  }

  /** A paper typed in by hand, for a DOI the provider does not know or when the provider is down. */
  async createManual(userId: number, input: PaperInputDto): Promise<UpsertResult> {
    this.limit(this.creations.hit(userId));
    const { match } = await this.papers.preview(input);
    if (match) {
      throw new ConflictException({
        statusCode: 409,
        code: 'already_exists',
        message: 'This paper is already in the catalog',
        paperId: match.id,
      });
    }
    return this.papers.upsert(input, { source: 'manual' });
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
