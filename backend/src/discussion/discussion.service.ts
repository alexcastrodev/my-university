import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import {
  CONCEPT_MODULES,
  ConceptSourceType,
  fromSourceId,
  parseCurriculumSourceId,
} from '../concept-lookup/concept-lookup.constants';
import { ConceptLookupService } from '../concept-lookup/concept-lookup.service';
import { Language } from '../shared/language';
import { DiscussionComment } from './discussion-comment.entity';
import { DiscussionMarker } from './discussion-marker.entity';
import { DiscussionVote } from './discussion-vote.entity';
import {
  CreateThreadDto,
  FeedAreasDto,
  FeedDto,
  TopicDto,
} from './discussion.dto';
import {
  areaPrefixes,
  areaSql,
  assembleThreads,
  CommentRow,
  decodeFeedCursor,
  FeedScope,
  feedPage,
  POSTS_PER_MINUTE,
  quoteAppearsIn,
  ThreadView,
  VoteInfo,
} from './discussion.logic';

export interface MarkerSummary {
  id: number;
  anchorKey: string;
  blockIndex: number;
  quote: string;
  commentCount: number;
  resolvedCount: number;
}

export interface MarkerDetail {
  id: number;
  quote: string;
  commentCount: number;
  threads: ThreadView[];
}

export interface FeedItem {
  markerId: number;
  area: string;
  conceptTitle: string;
  slug: string;
  route: string[];
  lang: string;
  quote: string;
  commentCount: number;
  resolvedCount: number;
  lastActivityAt: Date;
  startedByMe: boolean;
  participatedByMe: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

interface FeedRow {
  id: number;
  topicKey: string;
  lang: string;
  quote: string;
  area: string;
  commentCount: string;
  resolvedCount: string;
  lastActivityAt: Date;
  cursorAt: string;
  startedByMe: boolean;
  participatedByMe: boolean;
}

const AREA_SQL = areaSql(areaPrefixes(CONCEPT_MODULES), 'm."topicKey"');
const SCOPE_SQL: Record<FeedScope, string> = {
  all: 'TRUE',
  mine: '"startedByMe"',
  participated: '"participatedByMe"',
};

/** GitHub ids (comma separated) allowed to remove anyone's comment. Empty means nobody can. */
function moderatorIds(): Set<string> {
  return new Set(
    (process.env.MODERATOR_GITHUB_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

@Injectable()
export class DiscussionService {
  constructor(
    @InjectRepository(DiscussionMarker)
    private markers: Repository<DiscussionMarker>,
    @InjectRepository(DiscussionComment)
    private comments: Repository<DiscussionComment>,
    @InjectRepository(DiscussionVote) private votes: Repository<DiscussionVote>,
    @InjectRepository(User) private users: Repository<User>,
    private lookup: ConceptLookupService,
  ) {}

  /** The concept the request names, or 404. Also hands back its sections for the quote check. */
  private resolveTopic(topic: TopicDto) {
    const source = this.lookup.resolveTopic(
      topic.module,
      topic.slug,
      topic.discipline,
    );
    if (!source) throw new NotFoundException();
    const detail = this.lookup.resolveConceptDetail(
      source.sourceType,
      source.sourceId,
      topic.lang as 'en' | 'pt-BR',
    );
    if (!detail) throw new NotFoundException();
    return {
      topicKey: `${source.sourceType}:${source.sourceId}`,
      sections: detail.sections,
    };
  }

  /** Per-marker comment counts for one concept, what the page needs to draw its badges. */
  async summary(topic: TopicDto): Promise<MarkerSummary[]> {
    const { topicKey } = this.resolveTopic(topic);
    const rows: Record<string, string | number>[] = await this.markers.query(
      `SELECT m."id", m."anchorKey", m."blockIndex", m."quote",
              COUNT(c."id") FILTER (WHERE c."deletedAt" IS NULL) AS "commentCount",
              COUNT(c."id") FILTER (
                WHERE c."parentId" IS NULL AND c."deletedAt" IS NULL AND c."acceptedReplyId" IS NOT NULL
              ) AS "resolvedCount"
         FROM "discussion_marker" m
         LEFT JOIN "discussion_comment" c ON c."markerId" = m."id"
        WHERE m."topicKey" = $1 AND m."lang" = $2
        GROUP BY m."id"
       HAVING COUNT(c."id") FILTER (WHERE c."deletedAt" IS NULL) > 0
        ORDER BY m."blockIndex", m."id"`,
      [topicKey, topic.lang],
    );
    return rows.map((row) => ({
      id: Number(row['id']),
      anchorKey: String(row['anchorKey']),
      blockIndex: Number(row['blockIndex']),
      quote: String(row['quote']),
      commentCount: Number(row['commentCount']),
      resolvedCount: Number(row['resolvedCount']),
    }));
  }

  /**
   * One page of the discussion feed: markers with at least one live comment, most recent comment
   * first (ties by id), after the cursor. Concepts removed since are skipped.
   */
  async feed(dto: FeedDto, viewerId: number | null): Promise<FeedPage> {
    const cursor = dto.cursor ? decodeFeedCursor(dto.cursor) : null;
    if (dto.cursor && !cursor) throw new BadRequestException('Invalid cursor');

    const rows: FeedRow[] = await this.markers.query(
      `${this.feedSql(dto.scope)}
       SELECT *, to_char("lastActivityAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "cursorAt"
         FROM feed
        WHERE ($3::varchar IS NULL OR "area" = $3)
          AND ($4::timestamp IS NULL OR ("lastActivityAt", "id") < ($4::timestamp, $5::int))
        ORDER BY "lastActivityAt" DESC, "id" DESC
        LIMIT $6`,
      [
        viewerId,
        dto.lang ?? null,
        dto.area ?? null,
        cursor?.at ?? null,
        cursor?.id ?? null,
        dto.limit + 1,
      ],
    );
    const page = feedPage(rows, dto.limit);
    return {
      items: page.rows.flatMap((row) => this.feedItem(row) ?? []),
      nextCursor: page.nextCursor,
    };
  }

  /** Feed markers per area under the same scope and language, busiest area first. */
  async feedAreas(
    dto: FeedAreasDto,
    viewerId: number | null,
  ): Promise<{ area: string; count: number }[]> {
    const rows: { area: string; count: string }[] = await this.markers.query(
      `${this.feedSql(dto.scope)}
       SELECT "area", COUNT(*) AS "count"
         FROM feed
        WHERE "area" IS NOT NULL
        GROUP BY "area"
        ORDER BY COUNT(*) DESC, "area"`,
      [viewerId, dto.lang ?? null],
    );
    return rows.map((r) => ({ area: r.area, count: Number(r.count) }));
  }

  /**
   * CTEs shared by the feed and its area counts; $1 is the viewer (or null), $2 the language (or
   * null). A personal scope first narrows to the viewer's markers through the author index, so it
   * never aggregates the whole table.
   */
  private feedSql(scope: FeedScope): string {
    const onlyViewers =
      scope === 'all'
        ? ''
        : `AND c."markerId" IN (
             SELECT "markerId" FROM "discussion_comment"
              WHERE "authorId" = $1 AND "deletedAt" IS NULL)`;
    return `WITH activity AS (
        SELECT c."markerId",
               MAX(c."createdAt") AS "lastActivityAt",
               COUNT(*) AS "commentCount",
               COUNT(*) FILTER (
                 WHERE c."parentId" IS NULL AND c."acceptedReplyId" IS NOT NULL
               ) AS "resolvedCount",
               COALESCE(BOOL_OR(c."parentId" IS NULL AND c."authorId" = $1::int), false) AS "startedByMe",
               COALESCE(BOOL_OR(c."authorId" = $1::int), false) AS "participatedByMe"
          FROM "discussion_comment" c
         WHERE c."deletedAt" IS NULL ${onlyViewers}
         GROUP BY c."markerId"
      ), feed AS (
        SELECT m."id", m."topicKey", m."lang", m."quote", ${AREA_SQL} AS "area",
               a."lastActivityAt", a."commentCount", a."resolvedCount",
               a."startedByMe", a."participatedByMe"
          FROM activity a
          JOIN "discussion_marker" m ON m."id" = a."markerId"
         WHERE ($2::varchar IS NULL OR m."lang" = $2)
           AND ${SCOPE_SQL[scope]}
      )`;
  }

  private feedItem(row: FeedRow): FeedItem | null {
    const [sourceType, ...rest] = row.topicKey.split(':');
    const sourceId = rest.join(':');
    const where =
      parseCurriculumSourceId(sourceId) ??
      fromSourceId(sourceType as ConceptSourceType, sourceId);
    const detail = this.lookup.resolveConceptDetail(
      sourceType as ConceptSourceType,
      sourceId,
      row.lang as Language,
    );
    if (!where || !detail) return null;
    return {
      markerId: row.id,
      area: row.area,
      conceptTitle: detail.title,
      slug: where.slug,
      route: detail.route,
      lang: row.lang,
      quote: row.quote,
      commentCount: Number(row.commentCount),
      resolvedCount: Number(row.resolvedCount),
      lastActivityAt: row.lastActivityAt,
      startedByMe: row.startedByMe,
      participatedByMe: row.participatedByMe,
    };
  }

  async getMarker(
    markerId: number,
    viewerId: number | null,
  ): Promise<MarkerDetail> {
    const marker = await this.markers.findOneBy({ id: markerId });
    if (!marker) throw new NotFoundException();

    const rows = await this.commentRows(markerId);
    const voteRows: { commentId: number; count: string; mine: boolean }[] =
      await this.votes
        .createQueryBuilder('v')
        .select('v.commentId', 'commentId')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(BOOL_OR(v.userId = :viewer), false)', 'mine')
        .innerJoin('v.comment', 'c')
        .where('c.markerId = :markerId', { markerId })
        .setParameter('viewer', viewerId ?? 0)
        .groupBy('v.commentId')
        .getRawMany();
    const votes = new Map<number, VoteInfo>(
      voteRows.map((v) => [
        v.commentId,
        { count: Number(v.count), mine: v.mine },
      ]),
    );

    return {
      id: marker.id,
      quote: marker.quote,
      commentCount: rows.filter((r) => r.deletedAt === null).length,
      threads: assembleThreads(rows, votes, viewerId),
    };
  }

  /** Opens a thread on a block, creating the block's marker on first use. */
  async createThread(
    userId: number,
    dto: CreateThreadDto,
  ): Promise<{ markerId: number; commentId: number }> {
    const { topicKey, sections } = this.resolveTopic(dto);
    if (!quoteAppearsIn(sections, dto.quote)) throw new NotFoundException();
    await this.assertCanPost(userId);

    // Two readers commenting on a fresh paragraph at once must end up on the same marker.
    await this.markers
      .createQueryBuilder()
      .insert()
      .into(DiscussionMarker)
      .values({
        topicKey,
        lang: dto.lang,
        anchorKey: dto.anchorKey,
        blockIndex: dto.blockIndex,
        quote: dto.quote,
      })
      .orIgnore()
      .execute();
    const marker = await this.markers.findOneByOrFail({
      topicKey,
      lang: dto.lang,
      anchorKey: dto.anchorKey,
      blockIndex: dto.blockIndex,
    });

    const comment = await this.comments.save(
      this.comments.create({
        markerId: marker.id,
        parentId: null,
        authorId: userId,
        body: dto.body,
      }),
    );
    return { markerId: marker.id, commentId: comment.id };
  }

  /** Replies live one level deep: answering a reply attaches to its thread's root. */
  async reply(
    userId: number,
    markerId: number,
    parentId: number,
    body: string,
  ): Promise<{ commentId: number }> {
    let parent = await this.comments.findOneBy({ id: parentId, markerId });
    if (!parent || parent.deletedAt) throw new NotFoundException();
    if (parent.parentId !== null) {
      parent = await this.comments.findOneBy({ id: parent.parentId, markerId });
      if (!parent || parent.deletedAt) throw new NotFoundException();
    }
    await this.assertCanPost(userId);
    const comment = await this.comments.save(
      this.comments.create({
        markerId,
        parentId: parent.id,
        authorId: userId,
        body,
      }),
    );
    return { commentId: comment.id };
  }

  async edit(userId: number, commentId: number, body: string): Promise<void> {
    const comment = await this.liveComment(commentId);
    if (comment.authorId !== userId) throw new ForbiddenException();
    await this.comments.update(commentId, { body, editedAt: new Date() });
  }

  /** Soft delete by the author (or a moderator): the text is blanked, replies stay. */
  async remove(userId: number, commentId: number): Promise<void> {
    const comment = await this.liveComment(commentId);
    if (comment.authorId !== userId && !(await this.isModerator(userId)))
      throw new ForbiddenException();
    await this.comments.update(commentId, { body: '', deletedAt: new Date() });
    if (comment.parentId !== null) {
      // An accepted reply that goes away takes the thread's resolution with it.
      await this.comments.update(
        { id: comment.parentId, acceptedReplyId: commentId },
        { acceptedReplyId: null },
      );
    }
  }

  async vote(userId: number, commentId: number): Promise<void> {
    const comment = await this.liveComment(commentId);
    if (comment.authorId === userId) throw new ForbiddenException();
    await this.votes
      .createQueryBuilder()
      .insert()
      .into(DiscussionVote)
      .values({ commentId, userId })
      .orIgnore()
      .execute();
  }

  async unvote(userId: number, commentId: number): Promise<void> {
    await this.votes.delete({ commentId, userId });
  }

  /** Only the thread's owner, the root's author, can resolve it, and only with a reply of that thread. */
  async accept(userId: number, rootId: number, replyId: number): Promise<void> {
    const root = await this.ownedRoot(userId, rootId);
    const reply = await this.comments.findOneBy({
      id: replyId,
      parentId: root.id,
      deletedAt: IsNull(),
    });
    if (!reply) throw new NotFoundException();
    await this.comments.update(root.id, { acceptedReplyId: reply.id });
  }

  async unaccept(userId: number, rootId: number): Promise<void> {
    const root = await this.ownedRoot(userId, rootId);
    await this.comments.update(root.id, { acceptedReplyId: null });
  }

  private async ownedRoot(
    userId: number,
    rootId: number,
  ): Promise<DiscussionComment> {
    const root = await this.liveComment(rootId);
    if (root.parentId !== null) throw new NotFoundException();
    if (root.authorId !== userId) throw new ForbiddenException();
    return root;
  }

  private async liveComment(commentId: number): Promise<DiscussionComment> {
    const comment = await this.comments.findOneBy({
      id: commentId,
      deletedAt: IsNull(),
    });
    if (!comment) throw new NotFoundException();
    return comment;
  }

  private async commentRows(markerId: number): Promise<CommentRow[]> {
    const rows = await this.comments.find({
      where: { markerId },
      relations: { author: true },
    });
    return rows.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      authorId: c.authorId,
      authorName: c.author
        ? c.author.displayNameOverride?.trim() || c.author.displayName
        : null,
      authorAvatar: c.author?.avatarUrl ?? null,
      body: c.body,
      deletedAt: c.deletedAt,
      editedAt: c.editedAt,
      createdAt: c.createdAt,
      acceptedReplyId: c.acceptedReplyId,
    }));
  }

  private async isModerator(userId: number): Promise<boolean> {
    const user = await this.users.findOneBy({ id: userId });
    return !!user && moderatorIds().has(user.githubId);
  }

  /** nginx limits requests per IP; this keeps one account from flooding threads. */
  private async assertCanPost(userId: number): Promise<void> {
    const recent = await this.comments.countBy({
      authorId: userId,
      createdAt: MoreThan(new Date(Date.now() - 60_000)),
    });
    if (recent >= POSTS_PER_MINUTE) {
      throw new HttpException(
        'Too many comments, slow down',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
