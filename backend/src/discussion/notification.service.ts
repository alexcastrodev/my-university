import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import {
  ConceptSourceType,
  fromSourceId,
  parseCurriculumSourceId,
} from '../concept-lookup/concept-lookup.constants';
import { ConceptLookupService } from '../concept-lookup/concept-lookup.service';
import { Language } from '../shared/language';
import { DiscussionComment } from './discussion-comment.entity';
import { DiscussionMarker } from './discussion-marker.entity';
import { GENERAL_ANCHOR, LAB_ANCHOR } from './discussion.logic';
import { Notification } from './notification.entity';

const PAGE = 30;

export interface NotificationView {
  id: number;
  read: boolean;
  createdAt: Date;
  actor: string;
  excerpt: string;
  conceptTitle: string;
  route: string[];
  markerId: number;
  /** Replies to the lab's discussion open the Lab tab; paragraph ones open the marker. */
  lab: boolean;
  /** Replies to the discussion at the end of a concept open the concept at that discussion. */
  general: boolean;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification) private repo: Repository<Notification>,
    @InjectRepository(DiscussionComment)
    private comments: Repository<DiscussionComment>,
    @InjectRepository(DiscussionMarker)
    private markers: Repository<DiscussionMarker>,
    @InjectRepository(User) private users: Repository<User>,
    private lookup: ConceptLookupService,
  ) {}

  /** Tells the authors the reply was addressed to (never the replier, never someone who opted out). */
  async notifyReply(
    reply: DiscussionComment,
    addressedAuthorIds: (number | null)[],
  ): Promise<void> {
    const ids = [...new Set(addressedAuthorIds)].filter(
      (id): id is number => id !== null && id !== reply.authorId,
    );
    if (!ids.length) return;
    const recipients = await this.users.find({
      where: { id: In(ids), notifyReplies: true },
      select: { id: true },
    });
    if (!recipients.length) return;
    await this.repo.insert(
      recipients.map((u) => ({
        userId: u.id,
        commentId: reply.id,
        markerId: reply.markerId,
      })),
    );
  }

  unreadCount(userId: number): Promise<number> {
    return this.repo.countBy({ userId, readAt: IsNull() });
  }

  async list(userId: number): Promise<{ unread: number; items: NotificationView[] }> {
    const rows = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: PAGE,
    });
    const comments = new Map(
      (await this.comments.find({
        where: { id: In(rows.map((r) => r.commentId)) },
        relations: { author: true },
      })).map((c) => [c.id, c]),
    );
    const markers = new Map(
      (await this.markers.find({
        where: { id: In(rows.map((r) => r.markerId)) },
      })).map((m) => [m.id, m]),
    );
    const items = rows.flatMap((n) => {
      const comment = comments.get(n.commentId);
      const marker = markers.get(n.markerId);
      const detail = marker && this.detail(marker);
      if (!comment || !marker || !detail) return [];
      return {
        id: n.id,
        read: n.readAt !== null,
        createdAt: n.createdAt,
        actor: comment.author?.displayNameOverride ?? comment.author?.displayName ?? '',
        excerpt: comment.deletedAt ? '' : comment.body.slice(0, 160),
        conceptTitle: detail.title,
        route: detail.route,
        markerId: marker.id,
        lab: marker.anchorKey === LAB_ANCHOR,
        general: marker.anchorKey === GENERAL_ANCHOR,
      };
    });
    return { unread: await this.unreadCount(userId), items };
  }

  async markRead(userId: number, id?: number): Promise<void> {
    await this.repo.update(
      { userId, readAt: IsNull(), ...(id === undefined ? {} : { id }) },
      { readAt: new Date() },
    );
  }

  private detail(marker: DiscussionMarker) {
    const [sourceType, ...rest] = marker.topicKey.split(':');
    const sourceId = rest.join(':');
    const where =
      parseCurriculumSourceId(sourceId) ??
      fromSourceId(sourceType as ConceptSourceType, sourceId);
    if (!where) return null;
    return this.lookup.resolveConceptDetail(
      sourceType as ConceptSourceType,
      sourceId,
      marker.lang as Language,
    );
  }
}
