import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { PaperInputDto } from './paper.dto';
import { Paper, PaperType } from './paper.entity';
import { PaperAuthor } from './paper-author.entity';
import { PaperKeyword } from './paper-keyword.entity';
import { PaperConflict, PaperSource } from './paper-source.entity';
import {
  familyName,
  normalizeDoi,
  normalizeText,
  paperFingerprint,
} from './paper.normalize';

export interface SourceInfo {
  /** `manual`, `crossref`, `openalex`, ... */
  source: string;
  externalId?: string;
}

export interface PaperView {
  id: number;
  title: string;
  abstract: string | null;
  doi: string | null;
  venue: string | null;
  publicationDate: string | null;
  url: string | null;
  researchArea: string | null;
  type: PaperType;
  authors: { name: string; orcid: string | null }[];
  keywords: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertResult {
  paper: PaperView;
  created: boolean;
  conflicts: PaperConflict[];
}

/** `fill` only completes what is empty (imports); `overwrite` is an explicit correction. */
type Mode = 'fill' | 'overwrite';

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

const SCALARS = [
  'title',
  'abstract',
  'doi',
  'venue',
  'publicationDate',
  'url',
  'researchArea',
  'type',
] as const;

const text = (value?: string): string | null => value?.trim() || null;

/** "Lovelace, Ada" and "Ada Lovelace" give the same key: family name plus the given name's initial. */
function authorKey(name: string): string {
  const given = name.includes(',')
    ? name.split(',').slice(1).join(' ')
    : name.trim().split(/\s+/).slice(0, -1).join(' ');
  return `${familyName(name)}|${normalizeText(given).slice(0, 1)}`;
}

const sameText = (a: unknown, b: unknown) =>
  a === b || normalizeText(String(a)) === normalizeText(String(b));

function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { driverError?: { code?: string }; code?: string }).driverError
      ?.code ?? (err as { code?: string }).code;
  return code === '23505';
}

/** Thrown inside the transaction of `preview` to carry its result out and roll everything back. */
class Previewed {
  constructor(
    readonly match: PaperView | null,
    readonly conflicts: PaperConflict[],
  ) {}
}

@Injectable()
export class PapersService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /**
   * Adds a paper or merges it into the one it duplicates (same DOI, or same fingerprint when the DOI
   * is missing on either side), and records where the metadata came from.
   */
  upsert(input: PaperInputDto, source: SourceInfo): Promise<UpsertResult> {
    const clean = this.clean(input);
    return this.write((m) => this.upsertIn(m, clean, source, input));
  }

  /**
   * What `upsert` would do, without keeping any of it: the paper it would merge into (as it would look after
   * the merge) and the disagreements, or `match: null` when it would create a new paper.
   */
  async preview(
    input: PaperInputDto,
  ): Promise<{ match: PaperView | null; conflicts: PaperConflict[] }> {
    const clean = this.clean(input);
    const fingerprint = paperFingerprint(
      clean.title,
      clean.publicationDate,
      clean.authors?.[0]?.name,
    );
    try {
      await this.dataSource.transaction(async (m) => {
        const existing = await this.findDuplicate(m, clean.doi, fingerprint);
        if (!existing) throw new Previewed(null, []);
        const merged = await this.mergeInto(
          m,
          existing,
          clean,
          'fill',
          { source: 'preview' },
          input,
        );
        // Rolled back: the merge only ran to learn its result.
        throw new Previewed(merged.paper, merged.conflicts);
      });
    } catch (err) {
      if (err instanceof Previewed) {
        return { match: err.match, conflicts: err.conflicts };
      }
      throw err;
    }
    throw new Error('unreachable');
  }

  /** An explicit correction of one paper: given values replace the stored ones, and say so in the provenance. */
  correct(
    id: number,
    input: PaperInputDto,
    source: SourceInfo,
  ): Promise<UpsertResult> {
    const clean = this.clean(input);
    return this.write(async (m) => {
      const existing = await m.findOne(Paper, { where: { id } });
      if (!existing) throw new NotFoundException();
      return this.mergeInto(m, existing, clean, 'overwrite', source, input);
    });
  }

  /** The public record of a paper: bibliographic metadata only, never where it came from. */
  async getPublic(id: number): Promise<PaperView> {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) {
      throw new NotFoundException();
    }
    const paper = await this.dataSource.manager.findOne(Paper, {
      where: { id },
    });
    if (!paper) throw new NotFoundException();
    return this.view(this.dataSource.manager, paper);
  }

  /** The record plus its provenance and conflicts; for maintainers, not for the public API. */
  async get(id: number) {
    const paper = await this.dataSource.manager.findOne(Paper, {
      where: { id },
    });
    if (!paper) throw new NotFoundException();
    const sources = await this.dataSource.manager.find(PaperSource, {
      where: { paperId: id },
      order: { id: 'ASC' },
    });
    return {
      ...(await this.view(this.dataSource.manager, paper)),
      sources: sources.map((s) => ({
        source: s.source,
        externalId: s.externalId,
        retrievedAt: s.retrievedAt,
        conflicts: s.conflicts,
      })),
    };
  }

  /** Runs one write in a transaction, and once more if a concurrent write took the same identity first. */
  private async write(run: (m: EntityManager) => Promise<UpsertResult>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.dataSource.transaction(run);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (attempt > 0)
          throw new ConflictException(
            'Another paper already has this DOI or identity',
          );
      }
    }
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

  private async upsertIn(
    m: EntityManager,
    clean: Clean,
    source: SourceInfo,
    raw: PaperInputDto,
  ): Promise<UpsertResult> {
    const fingerprint = paperFingerprint(
      clean.title,
      clean.publicationDate,
      clean.authors?.[0]?.name,
    );
    const existing = await this.findDuplicate(m, clean.doi, fingerprint);
    if (existing) {
      return this.mergeInto(m, existing, clean, 'fill', source, raw);
    }
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
      }),
    );
    await this.replaceAuthors(m, paper.id, clean.authors ?? []);
    await this.addKeywords(m, paper.id, clean.keywords ?? []);
    await this.recordSource(m, paper.id, source, raw, []);
    return { paper: await this.view(m, paper), created: true, conflicts: [] };
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
  ) {
    return doi
      ? m.findOne(Paper, { where: { doi } }).then(
          (byDoi) =>
            byDoi ??
            m.findOne(Paper, {
              where: { fingerprint, doi: IsNull() },
              order: { id: 'ASC' },
            }),
        )
      : m.findOne(Paper, { where: { fingerprint }, order: { id: 'ASC' } });
  }

  private async mergeInto(
    m: EntityManager,
    paper: Paper,
    clean: Clean,
    mode: Mode,
    source: SourceInfo,
    raw: PaperInputDto,
  ): Promise<UpsertResult> {
    const conflicts: PaperConflict[] = [];
    const updates: Partial<Paper> = {};

    for (const field of SCALARS) {
      const incoming = clean[field];
      if (incoming == null) continue;
      const current = paper[field];
      // 'other' is the default, so it counts as "not set yet".
      if (current == null || (field === 'type' && current === 'other')) {
        (updates as Record<string, unknown>)[field] = incoming;
      } else if (!sameText(current, incoming)) {
        conflicts.push({
          field,
          current,
          incoming,
          resolution: mode === 'overwrite' ? 'replaced' : 'kept-current',
        });
        if (mode === 'overwrite')
          (updates as Record<string, unknown>)[field] = incoming;
      }
    }

    const authors = await m.find(PaperAuthor, {
      where: { paperId: paper.id },
      order: { position: 'ASC' },
    });
    let nextAuthors = authors.map((a) => ({ name: a.name, orcid: a.orcid }));
    if (clean.authors) {
      const sameList =
        authors.length === clean.authors.length &&
        authors.every(
          (a, i) => authorKey(a.name) === authorKey(clean.authors![i].name),
        );
      if (!authors.length && clean.authors.length) {
        nextAuthors = clean.authors;
      } else if (sameList) {
        // Same people: only complete the ORCID iDs the stored list lacks.
        nextAuthors = authors.map((a, i) => ({
          name: a.name,
          orcid: a.orcid ?? clean.authors![i].orcid,
        }));
      } else if (authors.length || mode === 'overwrite') {
        if (authors.length) {
          conflicts.push({
            field: 'authors',
            current: authors.map((a) => a.name),
            incoming: clean.authors.map((a) => a.name),
            resolution: mode === 'overwrite' ? 'replaced' : 'kept-current',
          });
        }
        if (mode === 'overwrite') nextAuthors = clean.authors;
      }
    }

    const title = updates.title ?? paper.title;
    const date = updates.publicationDate ?? paper.publicationDate;
    const fingerprint = paperFingerprint(title, date, nextAuthors[0]?.name);
    if (fingerprint !== paper.fingerprint) updates.fingerprint = fingerprint;

    if (Object.keys(updates).length) {
      await m.update(Paper, paper.id, updates);
    }
    if (
      JSON.stringify(nextAuthors) !==
      JSON.stringify(authors.map((a) => ({ name: a.name, orcid: a.orcid })))
    ) {
      await this.replaceAuthors(m, paper.id, nextAuthors);
    }

    if (clean.keywords) {
      if (mode === 'overwrite') {
        const stored = (
          await m.find(PaperKeyword, { where: { paperId: paper.id } })
        ).map((k) => k.keyword);
        const dropped = stored.filter((k) => !clean.keywords!.includes(k));
        if (dropped.length) {
          conflicts.push({
            field: 'keywords',
            current: stored,
            incoming: clean.keywords,
            resolution: 'replaced',
          });
          await m.delete(PaperKeyword, { paperId: paper.id });
        }
      }
      await this.addKeywords(m, paper.id, clean.keywords);
    }

    await this.recordSource(m, paper.id, source, raw, conflicts);
    const fresh = await m.findOneOrFail(Paper, { where: { id: paper.id } });
    return { paper: await this.view(m, fresh), created: false, conflicts };
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
    conflicts: PaperConflict[],
  ) {
    return m.save(
      m.create(PaperSource, {
        paperId,
        source: source.source,
        externalId: source.externalId ?? null,
        payload: payload as unknown as Record<string, unknown>,
        conflicts,
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
      id: paper.id,
      title: paper.title,
      abstract: paper.abstract,
      doi: paper.doi,
      venue: paper.venue,
      publicationDate: paper.publicationDate,
      url: paper.url,
      researchArea: paper.researchArea,
      type: paper.type,
      authors: authors.map((a) => ({ name: a.name, orcid: a.orcid })),
      keywords: keywords.map((k) => k.keyword),
      createdAt: paper.createdAt,
      updatedAt: paper.updatedAt,
    };
  }
}
