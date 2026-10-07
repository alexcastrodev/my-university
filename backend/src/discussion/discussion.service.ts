import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { ReviewService } from '../review/review.service';
import { DiscussionComment } from './discussion-comment.entity';
import { DiscussionMarker } from './discussion-marker.entity';
import { DiscussionVote } from './discussion-vote.entity';
import { CreateThreadDto, TopicDto } from './discussion.dto';
import {
  assembleThreads,
  CommentRow,
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
    private review: ReviewService,
  ) {}

  /** The concept the request names, or 404. Also hands back its sections for the quote check. */
  private resolveTopic(topic: TopicDto) {
    const source = this.review.resolveTopic(
      topic.module,
      topic.slug,
      topic.discipline,
    );
    if (!source) throw new NotFoundException();
    const detail = this.review.resolveConceptDetail(
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
