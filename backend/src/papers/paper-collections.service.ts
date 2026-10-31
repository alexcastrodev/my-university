import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaperRef, isUuid, refColumn } from './paper-ref';

export const COLLECTION_NAME_MAX = 80;

/** How many collections one reader keeps; `PAPER_COLLECTIONS_MAX_PER_USER` changes it. */
const maxPerUser = () => Number(process.env.PAPER_COLLECTIONS_MAX_PER_USER) || 100;

/** A collection as a paper's entry names it. */
export interface CollectionRef {
  id: string;
  name: string;
}

export interface CollectionView extends CollectionRef {
  /** How many library entries it holds. */
  count: number;
  createdAt: string;
}

const bad = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });
const conflict = (code: string, message: string) => new ConflictException({ statusCode: 409, code, message });
const notFound = () => new NotFoundException('Collection not found');
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

/** Single spaces, nothing at the ends. A blank name, or one with control or invisible characters, is refused. */
function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw bad('name_required', 'A collection needs a name');
  if (/\p{C}/u.test(name)) throw bad('name_invalid', 'A collection name is plain text');
  return name;
}

/**
 * A reader's own collections of library papers (#188). A collection is private and holds entries of the
 * reader's library, never papers: a paper can sit in many collections, taking it out of one leaves it in the
 * library, and deleting a collection deletes no paper and no PDF. Every method starts from the user id of the
 * session, so another reader's collection is the same 404 as one that does not exist.
 */
@Injectable()
export class PaperCollectionsService {
  constructor(@Inject(DataSource) private readonly dataSource: DataSource) {}

  /** The reader's collections by name, ignoring case (then by id, so equal-looking names keep a stable order). */
  async list(userId: number): Promise<{ items: CollectionView[] }> {
    return { items: await this.views(userId) };
  }

  async create(userId: number, rawName: string): Promise<CollectionView> {
    const name = cleanName(rawName);
    const [{ count }]: { count: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS count FROM paper_collection WHERE "userId" = $1`,
      [userId],
    );
    if (count >= maxPerUser()) {
      throw conflict('collections_limit', `You can keep up to ${maxPerUser()} collections. Delete one to add another.`);
    }
    try {
      const [{ id }]: { id: string }[] = await this.dataSource.query(
        `INSERT INTO paper_collection ("userId", "name") VALUES ($1, $2) RETURNING id`,
        [userId, name],
      );
      return (await this.views(userId, id))[0];
    } catch (e) {
      throw isUniqueViolation(e) ? conflict('name_taken', 'You already have a collection with that name') : e;
    }
  }

  async rename(userId: number, id: string, rawName: string): Promise<CollectionView> {
    const name = cleanName(rawName);
    await this.owned(userId, id);
    try {
      await this.dataSource.query(`UPDATE paper_collection SET "name" = $2, "updatedAt" = now() WHERE id = $1`, [id, name]);
    } catch (e) {
      throw isUniqueViolation(e) ? conflict('name_taken', 'You already have a collection with that name') : e;
    }
    return (await this.views(userId, id))[0];
  }

  /** Deletes the collection and its membership rows. The entries, the papers and the PDFs are not touched. */
  async remove(userId: number, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.dataSource.query(`DELETE FROM paper_collection WHERE id = $1`, [id]);
  }

  /** Puts a paper of the reader's library in the collection. Already there is fine. */
  async add(userId: number, id: string, ref: PaperRef): Promise<CollectionView> {
    await this.owned(userId, id);
    const { column, value } = refColumn(ref);
    const [entry]: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM paper_library_entry WHERE "userId" = $1 AND "${column}" = $2`,
      [userId, value],
    );
    if (!entry) throw new NotFoundException('Not in your library');
    await this.dataSource.query(
      `INSERT INTO paper_collection_item ("collectionId", "entryId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, entry.id],
    );
    return (await this.views(userId, id))[0];
  }

  /** Takes a paper out of the collection, and only out of it. Not being in it is fine. */
  async take(userId: number, id: string, ref: PaperRef): Promise<void> {
    await this.owned(userId, id);
    const { column, value } = refColumn(ref);
    await this.dataSource.query(
      `DELETE FROM paper_collection_item
        WHERE "collectionId" = $1
          AND "entryId" IN (SELECT id FROM paper_library_entry WHERE "userId" = $2 AND "${column}" = $3)`,
      [id, userId, value],
    );
  }

  /** The entries a collection of the reader holds: what the library list filters by. */
  async entryIds(userId: number, id: string): Promise<Set<number>> {
    await this.owned(userId, id);
    const rows: { entryId: number }[] = await this.dataSource.query(
      `SELECT "entryId" FROM paper_collection_item WHERE "collectionId" = $1`,
      [id],
    );
    return new Set(rows.map((r) => r.entryId));
  }

  /** The collections each of these entries sits in, by name. One query whatever the number of entries. */
  async of(entryIds: number[]): Promise<Map<number, CollectionRef[]>> {
    const out = new Map<number, CollectionRef[]>();
    if (!entryIds.length) return out;
    const rows: { entryId: number; id: string; name: string }[] = await this.dataSource.query(
      `SELECT i."entryId", c.id, c.name
         FROM paper_collection_item i JOIN paper_collection c ON c.id = i."collectionId"
        WHERE i."entryId" = ANY($1::int[])
        ORDER BY lower(c.name), c.id`,
      [entryIds],
    );
    for (const { entryId, id, name } of rows) out.set(entryId, [...(out.get(entryId) ?? []), { id, name }]);
    return out;
  }

  private async views(userId: number, id?: string): Promise<CollectionView[]> {
    const rows: { id: string; name: string; count: number; createdAt: Date }[] = await this.dataSource.query(
      `SELECT c.id, c.name, c."createdAt", count(i."entryId")::int AS count
         FROM paper_collection c LEFT JOIN paper_collection_item i ON i."collectionId" = c.id
        WHERE c."userId" = $1 ${id ? 'AND c.id = $2' : ''}
        GROUP BY c.id
        ORDER BY lower(c.name), c.id`,
      id ? [userId, id] : [userId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.count, createdAt: r.createdAt.toISOString() }));
  }

  /** 404 unless the collection exists and is the reader's. */
  private async owned(userId: number, id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const rows = await this.dataSource.query(`SELECT 1 FROM paper_collection WHERE id = $1 AND "userId" = $2`, [id, userId]);
    if (!rows.length) throw notFound();
  }
}
