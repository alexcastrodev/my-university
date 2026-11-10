import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PapersCatalogService, PaperSummary } from '../papers/papers-catalog.service';
import { isPaperSlug, isUuid } from '../papers/paper-ref';
import { Language } from '../shared/language';
import { PostDto } from './paper-group.dto';
import { PERSON_SQL, PersonView, personOf } from './paper-groups.service';
import { bad, canManage, conflict, managerIn, notFound, roleIn, withdrawShares } from './paper-group-access';

/** How many papers a group lists, and how many posts one reader may write in a minute (across groups). */
const maxPapers = () => Number(process.env.PAPER_GROUP_PAPERS_MAX) || 100;
const postsPerMinute = () => Number(process.env.PAPER_GROUP_POSTS_PER_MINUTE) || 10;
const POSTS_PAGE = 50;
const ANNOTATIONS_PAGE = 200;

export interface GroupPaperView extends PaperSummary {
  addedAt: string;
  addedBy: string | null;
  /** How many annotations members shared into the group for this paper. */
  sharedCount: number;
}

export interface GroupPostView {
  id: string;
  body: string;
  /** The group paper the post is about, if any. */
  paper: string | null;
  author: PersonView;
  createdAt: string;
  mine: boolean;
  /** The author, the owner and the moderators can take a post down. */
  canRemove: boolean;
}

export interface GroupAnnotationView {
  /** The id of the share, which is what takes it out of the group. */
  id: string;
  paper: string;
  kind: string;
  body: string | null;
  page: number | null;
  quote: string | null;
  author: PersonView;
  sharedAt: string;
  mine: boolean;
  canRemove: boolean;
}

/**
 * What a group holds besides its people (#190): the public papers it studies, a flat board of posts, and the
 * annotations members shared into it. A group holds public papers by slug, so a member's private paper or PDF
 * is never reachable through it. Every method starts from the reader's own membership, so leaving a group
 * ends access to all of this.
 *
 * The board is not the Discussion module: that one is a public forum (topics, a feed, votes, notifications, XP)
 * and a private room cannot be built on it without gating every one of those. It is a small table of its own.
 */
@Injectable()
export class PaperGroupBoardService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PapersCatalogService) private readonly catalog: PapersCatalogService,
  ) {}

  // ---- papers

  async papers(userId: number, id: string, lang: Language): Promise<{ items: GroupPaperView[] }> {
    await roleIn(this.dataSource, userId, id);
    const rows: { slug: string; addedAt: Date; addedBy: string | null; sharedCount: number }[] = await this.dataSource.query(
      `SELECT p."paperSlug" AS slug, p."addedAt",
              COALESCE(NULLIF(trim(u."displayNameOverride"), ''), u."displayName") AS "addedBy",
              (SELECT count(*)::int FROM paper_annotation_share_group g JOIN paper_annotation_share s ON s.id = g."shareId"
                WHERE g."groupId" = p."groupId" AND s."paperSlug" = p."paperSlug") AS "sharedCount"
         FROM paper_group_paper p LEFT JOIN "user" u ON u.id = p."addedBy"
        WHERE p."groupId" = $1 ORDER BY p."addedAt", p."paperSlug"`,
      [id],
    );
    // A paper whose file left the catalog is not shown, and comes back with the file.
    const items = rows.flatMap((r) => {
      const held = this.catalog.held(r.slug, lang);
      return held ? [{ ...held.summary, addedAt: r.addedAt.toISOString(), addedBy: r.addedBy, sharedCount: r.sharedCount }] : [];
    });
    return { items };
  }

  /** Adds a public paper to the group; already there is fine. A private paper has no place in a group. */
  async addPaper(userId: number, id: string, slug: string, lang: Language): Promise<GroupPaperView> {
    await managerIn(this.dataSource, userId, id);
    if (isUuid(slug)) throw bad('private_paper', 'A group studies public papers; a paper only you can see stays yours');
    if (!isPaperSlug(slug) || !this.catalog.has(slug)) throw notFound('Paper');
    await this.dataSource.transaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('paper_group_paper'), hashtext($1))`, [id]);
      const [{ count }]: { count: number }[] = await tx.query(
        `SELECT count(*)::int AS count FROM paper_group_paper WHERE "groupId" = $1 AND "paperSlug" <> $2`,
        [id, slug],
      );
      if (count >= maxPapers()) throw conflict('papers_limit', `A group lists up to ${maxPapers()} papers.`);
      await tx.query(
        `INSERT INTO paper_group_paper ("groupId", "paperSlug", "addedBy") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, slug, userId],
      );
    });
    return (await this.papers(userId, id, lang)).items.find((p) => p.id === slug)!;
  }

  /** Takes a paper off the list. The annotations members shared into the group for it go with it; the posts stay. */
  async removePaper(userId: number, id: string, slug: string): Promise<void> {
    await managerIn(this.dataSource, userId, id);
    await this.dataSource.transaction(async (tx) => {
      await withdrawShares(tx, { groupId: id, paperSlug: slug });
      await tx.query(`DELETE FROM paper_group_paper WHERE "groupId" = $1 AND "paperSlug" = $2`, [id, slug]);
    });
  }

  // ---- posts

  async posts(userId: number, id: string, query: { paper?: string; before?: string }): Promise<{ items: GroupPostView[]; next: string | null }> {
    const role = await roleIn(this.dataSource, userId, id);
    if (query.before !== undefined && !isUuid(query.before)) throw bad('before_invalid', 'before is the id of a post');
    const rows: (Parameters<typeof personOf>[0] & { id: string; body: string; paper: string | null; authorId: number; createdAt: Date })[] =
      await this.dataSource.query(
        `SELECT p.id, p.body, p."paperSlug" AS paper, p."authorId", p."createdAt", ${PERSON_SQL}
           FROM paper_group_post p JOIN "user" u ON u.id = p."authorId"
          WHERE p."groupId" = $1
            AND ($2::varchar IS NULL OR p."paperSlug" = $2)
            AND ($3::uuid IS NULL OR p.id < $3::uuid)
          ORDER BY p.id DESC LIMIT ${POSTS_PAGE}`,
        [id, query.paper ?? null, query.before ?? null],
      );
    return {
      items: rows.map((r) => ({
        id: r.id,
        body: r.body,
        paper: r.paper,
        author: personOf(r),
        createdAt: r.createdAt.toISOString(),
        mine: r.authorId === userId,
        canRemove: r.authorId === userId || canManage(role),
      })),
      next: rows.length === POSTS_PAGE ? rows[rows.length - 1].id : null,
    };
  }

  async post(userId: number, id: string, dto: PostDto): Promise<GroupPostView> {
    await roleIn(this.dataSource, userId, id);
    const body = dto.body.trim();
    if (!body) throw bad('body_required', 'Write something to post');
    if (dto.paper !== undefined) {
      const [onList]: { one: number }[] = await this.dataSource.query(
        `SELECT 1 AS one FROM paper_group_paper WHERE "groupId" = $1 AND "paperSlug" = $2`,
        [id, dto.paper],
      );
      if (!onList) throw bad('paper_not_in_group', 'That paper is not on the group list');
    }
    const [{ recent }]: { recent: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS recent FROM paper_group_post WHERE "authorId" = $1 AND "createdAt" > now() - interval '1 minute'`,
      [userId],
    );
    if (recent >= postsPerMinute()) {
      throw new HttpException({ statusCode: 429, code: 'too_many_posts', message: 'Slow down: wait a moment before posting again' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const [{ id: postId }]: { id: string }[] = await this.dataSource.query(
      `INSERT INTO paper_group_post ("groupId", "authorId", "paperSlug", body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [id, userId, dto.paper ?? null, body],
    );
    const [created]: (Parameters<typeof personOf>[0] & { createdAt: Date; paper: string | null })[] = await this.dataSource.query(
      `SELECT p."createdAt", p."paperSlug" AS paper, ${PERSON_SQL} FROM paper_group_post p JOIN "user" u ON u.id = p."authorId" WHERE p.id = $1`,
      [postId],
    );
    return { id: postId, body, paper: created.paper, author: personOf(created), createdAt: created.createdAt.toISOString(), mine: true, canRemove: true };
  }

  /** The author, the owner and the moderators take a post down. Anyone else, or a post of another group, is a 404 or a 403. */
  async removePost(userId: number, id: string, postId: string): Promise<void> {
    const role = await roleIn(this.dataSource, userId, id);
    if (!isUuid(postId)) throw notFound('Post');
    const [post]: { authorId: number }[] = await this.dataSource.query(
      `SELECT "authorId" FROM paper_group_post WHERE id = $1 AND "groupId" = $2`,
      [postId, id],
    );
    if (!post) throw notFound('Post');
    if (post.authorId !== userId && !canManage(role)) throw notFound('Post');
    await this.dataSource.query(`DELETE FROM paper_group_post WHERE id = $1`, [postId]);
  }

  // ---- annotations shared into the group

  /** What members shared into the group (#187 copies: a note or a few words, never rectangles or a PDF), with who shared it. */
  async annotations(userId: number, id: string, paper?: string): Promise<{ items: GroupAnnotationView[] }> {
    const role = await roleIn(this.dataSource, userId, id);
    const rows: (Parameters<typeof personOf>[0] & {
      id: string; paperSlug: string; kind: string; body: string | null; page: number | null; quote: string | null; authorId: number; createdAt: Date;
    })[] = await this.dataSource.query(
      `SELECT s.id, s."paperSlug", s.kind, s.body, s.page, s.quote, s."authorId", s."createdAt", ${PERSON_SQL}
         FROM paper_annotation_share_group g
         JOIN paper_annotation_share s ON s.id = g."shareId"
         JOIN "user" u ON u.id = s."authorId"
        WHERE g."groupId" = $1 AND ($2::varchar IS NULL OR s."paperSlug" = $2)
        ORDER BY s."paperSlug", s.page NULLS LAST, s."createdAt", s.id
        LIMIT ${ANNOTATIONS_PAGE}`,
      [id, paper ?? null],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        paper: r.paperSlug,
        kind: r.kind,
        body: r.body,
        page: r.page,
        quote: r.quote,
        author: personOf(r),
        sharedAt: r.createdAt.toISOString(),
        mine: r.authorId === userId,
        canRemove: r.authorId === userId || canManage(role),
      })),
    };
  }

  /** Takes one annotation out of this group, for its author, the owner or a moderator. Its other audiences are not touched. */
  async removeAnnotation(userId: number, id: string, shareId: string): Promise<void> {
    const role = await roleIn(this.dataSource, userId, id);
    if (!isUuid(shareId)) throw notFound('Annotation');
    const [row]: { authorId: number }[] = await this.dataSource.query(
      `SELECT s."authorId" FROM paper_annotation_share_group g JOIN paper_annotation_share s ON s.id = g."shareId"
        WHERE g."groupId" = $1 AND s.id = $2`,
      [id, shareId],
    );
    if (!row || (row.authorId !== userId && !canManage(role))) throw notFound('Annotation');
    await this.dataSource.transaction((tx) => withdrawShares(tx, { groupId: id, shareId }));
  }
}
