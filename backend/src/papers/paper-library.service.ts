import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Paper } from './paper.entity';
import {
  AddToLibraryDto,
  LibraryQueryDto,
  MAX_TAG_LENGTH,
  UpdateLibraryEntryDto,
} from './paper-library.dto';
import {
  LIBRARY_STATUSES,
  LibraryStatus,
  PaperLibraryEntry,
} from './paper-library.entity';
import { PAPER_PAGE_DEFAULT_LIMIT } from './paper-query.dto';
import { PaperSummary, PapersCatalogService } from './papers-catalog.service';

const MAX_ID = 2_147_483_647;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the reader keeps about a paper. Dates are ISO strings; `completedAt` is a plain day. */
export interface LibraryEntryView {
  /** The paper's public id. */
  paperId: string;
  status: LibraryStatus;
  rating: number | null;
  tags: string[];
  addedAt: string;
  completedAt: string | null;
}

export interface LibraryItem extends PaperSummary {
  library: LibraryEntryView;
}

export interface LibraryPage {
  items: LibraryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface LibraryFacets {
  total: number;
  statuses: { value: LibraryStatus; count: number }[];
  tags: { value: string; count: number }[];
}

const TAG_FACET_LIMIT = 100;

const view = (e: PaperLibraryEntry, publicId: string): LibraryEntryView => ({
  paperId: publicId,
  status: e.status,
  rating: e.rating,
  tags: e.tags,
  addedAt: e.addedAt.toISOString(),
  completedAt: e.completedAt,
});

const today = () => new Date().toISOString().slice(0, 10);

/** Lowercase, single spaces, no repeats; blank ones drop out. Control and invisible characters are refused. */
function cleanTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag) continue;
    if (/\p{C}/u.test(tag) || tag.length > MAX_TAG_LENGTH) {
      throw new BadRequestException(
        'tags must be plain text of at most 40 characters',
      );
    }
    out.add(tag);
  }
  return [...out];
}

/** A real calendar day that is not in the future (one day of slack for readers ahead of UTC). */
function checkDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  const real =
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === day;
  if (!real) throw new BadRequestException('completedAt is not a valid date');
  if (parsed.getTime() > Date.now() + DAY_MS) {
    throw new BadRequestException('completedAt cannot be in the future');
  }
  return day;
}

/**
 * A reader's private library. Every method takes the user id from the session and addresses entries
 * by paper id, so there is no entry id of someone else's to guess: another user's row is simply not
 * reachable from here.
 */
@Injectable()
export class PaperLibraryService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PapersCatalogService)
    private readonly catalog: PapersCatalogService,
  ) {}

  /** Puts a paper in the library. Adding what is already there changes nothing (`created: false`). */
  async add(
    userId: number,
    dto: AddToLibraryDto,
  ): Promise<{ entry: LibraryEntryView; created: boolean }> {
    const paper = await this.dataSource.getRepository(Paper).findOne({
      where: { publicId: dto.paperId.toLowerCase() },
      select: { id: true, publicId: true },
    });
    if (!paper) throw new NotFoundException('Paper not found');

    const status = dto.status ?? 'to-read';
    const rows: { id: number }[] = await this.dataSource.query(
      `INSERT INTO paper_library_entry ("userId", "paperId", "status", "completedAt")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", "paperId") DO NOTHING
       RETURNING id`,
      [userId, paper.id, status, status === 'read' ? today() : null],
    );
    return {
      entry: await this.get(userId, paper.id),
      created: rows.length > 0,
    };
  }

  async get(userId: number, paperId: number): Promise<LibraryEntryView> {
    const entry = await this.entryOf(userId, paperId);
    return view(entry, entry.paper.publicId);
  }

  async update(
    userId: number,
    paperId: number,
    dto: UpdateLibraryEntryDto,
  ): Promise<LibraryEntryView> {
    const entry = await this.entryOf(userId, paperId);
    const status = dto.status ?? entry.status;

    if (status !== 'read' && dto.completedAt) {
      throw new BadRequestException(
        'completedAt needs the status to be "read"',
      );
    }
    if (status !== 'read') {
      entry.completedAt = null;
    } else if (dto.completedAt !== undefined) {
      entry.completedAt =
        dto.completedAt === null ? null : checkDay(dto.completedAt);
    } else if (entry.status !== 'read') {
      entry.completedAt = today();
    }
    entry.status = status;
    if (dto.rating !== undefined) entry.rating = dto.rating;
    if (dto.tags !== undefined) entry.tags = cleanTags(dto.tags);

    const saved = await this.dataSource
      .getRepository(PaperLibraryEntry)
      .save(entry);
    return view(saved, entry.paper.publicId);
  }

  /** Takes the paper out of the reader's library. The paper and other readers' entries stay. */
  async remove(userId: number, paperId: number): Promise<void> {
    if (!this.validId(paperId)) return;
    await this.dataSource
      .getRepository(PaperLibraryEntry)
      .delete({ userId, paperId });
  }

  async list(userId: number, query: LibraryQueryDto): Promise<LibraryPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? PAPER_PAGE_DEFAULT_LIMIT;
    const builder = this.dataSource
      .getRepository(Paper)
      .createQueryBuilder('p')
      .innerJoin(
        PaperLibraryEntry,
        'e',
        'e.paperId = p.id AND e.userId = :userId',
        { userId },
      );
    this.catalog.filter(builder, query);
    if (query.status) {
      builder.andWhere('e.status = :status', { status: query.status });
    }
    if (query.tag) {
      builder.andWhere(':tag = ANY(e.tags)', { tag: query.tag.toLowerCase() });
    }

    const total = await builder.getCount();
    switch (query.sort) {
      case 'title':
        builder.orderBy('LOWER(p.title)', 'ASC').addOrderBy('p.id', 'ASC');
        break;
      case 'completed':
        builder
          .orderBy('e.completedAt', 'DESC', 'NULLS LAST')
          .addOrderBy('e.id', 'DESC');
        break;
      case 'rating':
        builder
          .orderBy('e.rating', 'DESC', 'NULLS LAST')
          .addOrderBy('e.id', 'DESC');
        break;
      default:
        builder.orderBy('e.addedAt', 'DESC').addOrderBy('e.id', 'DESC');
    }
    const papers = await builder
      .offset((page - 1) * limit)
      .limit(limit)
      .getMany();

    const [summaries, entries] = await Promise.all([
      this.catalog.summaries(papers),
      papers.length
        ? this.dataSource
            .getRepository(PaperLibraryEntry)
            .createQueryBuilder('e')
            .where('e.userId = :userId AND e.paperId IN (:...ids)', {
              userId,
              ids: papers.map((p) => p.id),
            })
            .getMany()
        : [],
    ]);
    const entryOf = new Map(entries.map((e) => [e.paperId, e]));
    // Summaries come back in the order of `papers`, and carry the public id: the entry is found by the key.
    return {
      items: summaries.map((s, i) => ({
        ...s,
        library: view(entryOf.get(papers[i].id)!, s.id),
      })),
      total,
      page,
      limit,
    };
  }

  /** How many papers the reader has per status, and per tag: what the library filters offer. */
  async facets(userId: number): Promise<LibraryFacets> {
    const [byStatus, byTag]: [
      { value: LibraryStatus; count: string }[],
      { value: string; count: string }[],
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT "status" AS value, COUNT(*) AS count FROM paper_library_entry WHERE "userId" = $1 GROUP BY "status"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT tag AS value, COUNT(*) AS count
           FROM paper_library_entry, unnest("tags") AS tag
          WHERE "userId" = $1
          GROUP BY tag ORDER BY COUNT(*) DESC, tag ASC LIMIT $2`,
        [userId, TAG_FACET_LIMIT],
      ),
    ]);
    const counts = new Map(byStatus.map((r) => [r.value, Number(r.count)]));
    const statuses = LIBRARY_STATUSES.map((value) => ({
      value,
      count: counts.get(value) ?? 0,
    }));
    return {
      total: statuses.reduce((sum, s) => sum + s.count, 0),
      statuses,
      tags: byTag.map((r) => ({ value: r.value, count: Number(r.count) })),
    };
  }

  private validId(id: number) {
    return Number.isSafeInteger(id) && id >= 1 && id <= MAX_ID;
  }

  private async entryOf(
    userId: number,
    paperId: number,
  ): Promise<PaperLibraryEntry> {
    const entry = this.validId(paperId)
      ? await this.dataSource
          .getRepository(PaperLibraryEntry)
          .findOne({ where: { userId, paperId }, relations: { paper: true } })
      : null;
    if (!entry) throw new NotFoundException('Not in your library');
    return entry;
  }
}
