import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConceptLookupService } from '../concept-lookup/concept-lookup.service';
import { isUuid } from '../papers/paper-ref';
import { Language } from '../shared/language';
import { XpService } from '../xp/xp.service';
import { locate, scopeOf } from './scope';

export const BOOKMARK_TABS = ['concept', 'lab'] as const;
export type BookmarkTab = (typeof BOOKMARK_TABS)[number];

/** A concept as the client names it: its module and slug, plus the discipline for Computer Science. */
export interface ConceptTarget {
  module: string;
  slug: string;
  discipline?: string;
}

export interface BookmarkView extends ConceptTarget {
  id: string;
  scope: string;
  title: string;
  route: string[];
  tab: BookmarkTab;
  updatedAt: string;
}

export interface BookmarksView {
  bookmarks: BookmarkView[];
  labDone: ConceptTarget[];
}

interface BookmarkRow {
  id: string;
  scope: string;
  sourceId: string;
  tab: BookmarkTab;
  updatedAt: Date;
}

/**
 * Every write answers with the reader's whole state, so the client replaces what it holds instead of
 * merging, and a title always comes from the current content and language.
 */
@Injectable()
export class BookmarksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly lookup: ConceptLookupService,
    private readonly xp: XpService,
  ) {}

  async list(userId: number, lang: Language): Promise<BookmarksView> {
    const [rows, done]: [BookmarkRow[], { sourceId: string }[]] = await Promise.all([
      this.dataSource.query(
        `SELECT id, scope, "sourceId", tab, "updatedAt" FROM user_bookmark WHERE "userId" = $1 ORDER BY "updatedAt" DESC`,
        [userId],
      ),
      this.dataSource.query(`SELECT "sourceId" FROM user_lab_done WHERE "userId" = $1`, [userId]),
    ]);

    const bookmarks: BookmarkView[] = [];
    for (const row of rows) {
      const where = locate(row.sourceId);
      const detail = this.lookup.resolveConceptDetail('concept-read', row.sourceId, lang);
      // The concept was removed from the content since the bookmark was placed: nothing to go back to.
      if (!where || !detail) continue;
      bookmarks.push({
        id: row.id,
        scope: row.scope,
        module: where.module,
        discipline: where.discipline,
        slug: where.slug,
        title: detail.title,
        route: where.route,
        tab: row.tab,
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    const labDone = done.flatMap(({ sourceId }) => {
      const where = locate(sourceId);
      return where ? [{ module: where.module, discipline: where.discipline, slug: where.slug }] : [];
    });
    return { bookmarks, labDone };
  }

  async set(userId: number, target: ConceptTarget, tab: unknown, lang: Language): Promise<BookmarksView> {
    if (!BOOKMARK_TABS.includes(tab as BookmarkTab)) throw new BadRequestException('Invalid tab');
    const sourceId = this.sourceIdOf(target);
    const scope = scopeOf(sourceId);
    if (!scope) throw new NotFoundException();
    await this.dataSource.query(
      `INSERT INTO user_bookmark ("userId", scope, "sourceId", tab) VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", scope) DO UPDATE SET "sourceId" = EXCLUDED."sourceId", tab = EXCLUDED.tab, "updatedAt" = now()`,
      [userId, scope, sourceId, tab],
    );
    return this.list(userId, lang);
  }

  async remove(userId: number, id: string, lang: Language): Promise<BookmarksView> {
    if (!isUuid(id)) throw new NotFoundException();
    await this.dataSource.query(`DELETE FROM user_bookmark WHERE id = $1 AND "userId" = $2`, [id, userId]);
    return this.list(userId, lang);
  }

  async setLabDone(userId: number, target: ConceptTarget, done: unknown, lang: Language): Promise<BookmarksView> {
    if (typeof done !== 'boolean') throw new BadRequestException('done must be a boolean');
    const sourceId = this.sourceIdOf(target);
    if (done) {
      await this.dataSource.query(
        `INSERT INTO user_lab_done ("userId", "sourceId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, sourceId],
      );
      await this.xp.grantLabDoneXp(userId, sourceId);
    } else {
      await this.dataSource.query(`DELETE FROM user_lab_done WHERE "userId" = $1 AND "sourceId" = $2`, [userId, sourceId]);
    }
    return this.list(userId, lang);
  }

  /** The concept's identity, only if it exists. Java Minute and C# Minute episodes are not concepts: no bookmark, no lab. */
  private sourceIdOf({ module, slug, discipline }: ConceptTarget): string {
    const source = this.lookup.resolveTopic(module, slug, discipline);
    if (!source || source.sourceType !== 'concept-read') throw new NotFoundException();
    if (!this.lookup.resolveConceptDetail(source.sourceType, source.sourceId)) throw new NotFoundException();
    return source.sourceId;
  }
}
