import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Language, normalizeLanguage } from '../shared/language';
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
import { byTitle, matchesFilter } from './paper-filter';
import { PaperAuditService } from '../paper-audit/paper-audit.service';
import { CollectionRef, PaperCollectionsService } from './paper-collections.service';
import { PAPER_PAGE_DEFAULT_LIMIT } from './paper-query.dto';
import { isPaperSlug, PaperRef, publicIdOf, refColumn } from './paper-ref';
import {
  HeldPaper,
  PaperSummary,
  PapersCatalogService,
  searchableOf,
} from './papers-catalog.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the reader keeps about a paper. Dates are ISO strings; `completedAt` is a plain day. */
export interface LibraryEntryView {
  /** The paper's public id: the slug of a public paper, the UUIDv7 of a private one. */
  paperId: string;
  /** True for a paper only this reader has (#203): it has no public page and is deleted with its entry. */
  private: boolean;
  status: LibraryStatus;
  rating: number | null;
  tags: string[];
  addedAt: string;
  completedAt: string | null;
  /** The reader's collections this paper sits in (#188), by name. */
  collections: CollectionRef[];
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

const view = (e: PaperLibraryEntry, collections: CollectionRef[]): LibraryEntryView => ({
  paperId: e.paperSlug ?? e.paper!.publicId,
  private: e.paperSlug === null,
  status: e.status,
  rating: e.rating,
  tags: e.tags,
  addedAt: e.addedAt.toISOString(),
  completedAt: e.completedAt,
  collections,
});

/** An entry with the paper it is for. */
interface Held {
  entry: PaperLibraryEntry;
  paper: HeldPaper;
}

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
 * by paper, so there is no entry id of someone else's to guess: another user's row is simply not
 * reachable from here.
 *
 * A public paper is a file and a private one a row, so a list is put together in memory from the reader's
 * entries (a library is one reader's, not the catalog).
 */
@Injectable()
export class PaperLibraryService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PapersCatalogService)
    private readonly catalog: PapersCatalogService,
    @Inject(PaperCollectionsService)
    private readonly collections: PaperCollectionsService,
    @Inject(PaperAuditService)
    private readonly audit: PaperAuditService,
  ) {}

  /** Puts a public paper in the library. Adding what is already there changes nothing (`created: false`). */
  async add(
    userId: number,
    dto: AddToLibraryDto,
  ): Promise<{ entry: LibraryEntryView; created: boolean }> {
    if (!isPaperSlug(dto.paperId) || !this.catalog.has(dto.paperId)) {
      throw new NotFoundException('Paper not found');
    }
    return this.addRef(userId, { kind: 'public', slug: dto.paperId }, dto.status);
  }

  /** The same for a paper the caller already holds (a private one has no public way in). */
  async addRef(
    userId: number,
    ref: PaperRef,
    status: LibraryStatus = 'to-read',
  ): Promise<{ entry: LibraryEntryView; created: boolean }> {
    const { column, value } = refColumn(ref);
    const rows: { id: number }[] = await this.dataSource.query(
      `INSERT INTO paper_library_entry ("userId", "${column}", "status", "completedAt")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", "${column}") DO NOTHING
       RETURNING id`,
      [userId, value, status, status === 'read' ? today() : null],
    );
    return {
      entry: await this.get(userId, ref),
      created: rows.length > 0,
    };
  }

  /** Whether the paper is in the reader's library. */
  async has(userId: number, ref: PaperRef): Promise<boolean> {
    const { column, value } = refColumn(ref);
    const rows = await this.dataSource.query(
      `SELECT 1 FROM paper_library_entry WHERE "userId" = $1 AND "${column}" = $2`,
      [userId, value],
    );
    return rows.length > 0;
  }

  async get(userId: number, ref: PaperRef): Promise<LibraryEntryView> {
    return this.viewOf(await this.entryOf(userId, ref));
  }

  async update(
    userId: number,
    ref: PaperRef,
    dto: UpdateLibraryEntryDto,
  ): Promise<LibraryEntryView> {
    const entry = await this.entryOf(userId, ref);
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

    return this.viewOf(
      await this.dataSource.getRepository(PaperLibraryEntry).save(entry),
    );
  }

  /**
   * Takes the paper out of the reader's library. A public paper and other readers' entries stay; the reader's
   * own private paper (#203) exists only for this entry, so it goes with it, and its PDF with it.
   */
  async remove(userId: number, ref: PaperRef): Promise<void> {
    const { column, value } = refColumn(ref);
    // TypeORM answers a DELETE with `[rows, count]`.
    const [gone]: [unknown[], number] = await this.dataSource.query(
      `DELETE FROM paper_library_entry WHERE "userId" = $1 AND "${column}" = $2 RETURNING 1`,
      [userId, value],
    );
    if (gone.length) {
      await this.audit.record(userId, 'library.remove', publicIdOf(ref), { private: ref.kind === 'private' });
    }
    if (ref.kind === 'private') {
      await this.dataSource
        .getRepository(Paper)
        .delete({ id: ref.id, ownerId: userId });
    }
  }

  async list(userId: number, query: LibraryQueryDto): Promise<LibraryPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? PAPER_PAGE_DEFAULT_LIMIT;
    const tag = query.tag?.toLowerCase();
    const inCollection = query.collection
      ? await this.collections.entryIds(userId, query.collection)
      : null;
    const found = (await this.held(userId, normalizeLanguage(query.lang)))
      .filter(
        ({ entry, paper }) =>
          matchesFilter(searchableOf(paper), query) &&
          (!query.status || entry.status === query.status) &&
          (!tag || entry.tags.includes(tag)) &&
          (!inCollection || inCollection.has(entry.id)),
      )
      .sort(sorter(query.sort));
    const shown = found.slice((page - 1) * limit, page * limit);
    const named = await this.collections.of(shown.map((h) => h.entry.id));
    return {
      items: shown.map(({ entry, paper }) => ({
        ...paper.summary,
        library: view(entry, named.get(entry.id) ?? []),
      })),
      total: found.length,
      page,
      limit,
    };
  }

  /** How many papers the reader has per status, and per tag: what the library filters offer. */
  async facets(userId: number): Promise<LibraryFacets> {
    const held = await this.held(userId, 'en');
    const statuses = LIBRARY_STATUSES.map((value) => ({
      value,
      count: held.filter(({ entry }) => entry.status === value).length,
    }));
    const tags = new Map<string, number>();
    for (const { entry } of held) {
      for (const tag of entry.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    return {
      total: held.length,
      statuses,
      tags: [...tags]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, TAG_FACET_LIMIT),
    };
  }

  /**
   * The reader's entries with their papers. An entry whose public paper is no longer in the files is not
   * shown (and not counted): it stays in the table, so the paper coming back brings it back too.
   */
  private async held(userId: number, lang: Language): Promise<Held[]> {
    const entries = await this.dataSource
      .getRepository(PaperLibraryEntry)
      .find({ where: { userId }, relations: { paper: true } });
    const own = await this.catalog.heldRows(
      entries.flatMap((e) => (e.paper?.ownerId === userId ? [e.paper] : [])),
    );
    const ownBy = new Map(own.map((h) => [h.summary.id, h]));
    return entries.flatMap((entry) => {
      const paper = entry.paperSlug
        ? this.catalog.held(entry.paperSlug, lang)
        : ownBy.get(entry.paper!.publicId);
      return paper ? [{ entry, paper }] : [];
    });
  }

  private async viewOf(entry: PaperLibraryEntry): Promise<LibraryEntryView> {
    return view(entry, (await this.collections.of([entry.id])).get(entry.id) ?? []);
  }

  private async entryOf(
    userId: number,
    ref: PaperRef,
  ): Promise<PaperLibraryEntry> {
    const entry = await this.dataSource.getRepository(PaperLibraryEntry).findOne({
      where:
        ref.kind === 'public'
          ? { userId, paperSlug: ref.slug }
          : { userId, paperId: ref.id },
      relations: { paper: true },
    });
    if (!entry) throw new NotFoundException('Not in your library');
    return entry;
  }
}

/** The library sorts: by title, by the day it was finished, by rating, or (the default) newest added first. */
function sorter(sort?: string): (a: Held, b: Held) => number {
  const newest = (a: Held, b: Held) =>
    b.entry.addedAt.getTime() - a.entry.addedAt.getTime() || b.entry.id - a.entry.id;
  /** Descending, a missing value last, then the newest added. */
  const desc = (value: (h: Held) => string | number | null) => (a: Held, b: Held) => {
    const x = value(a);
    const y = value(b);
    if (x === y) return b.entry.id - a.entry.id;
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? 1 : -1;
  };
  switch (sort) {
    case 'title':
      return (a, b) => byTitle(a.paper.summary, b.paper.summary);
    case 'completed':
      return desc((h) => h.entry.completedAt);
    case 'rating':
      return desc((h) => h.entry.rating);
    default:
      return newest;
  }
}
