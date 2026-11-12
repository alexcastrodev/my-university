import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { DiscussionComment } from './discussion-comment.entity';

export type NotificationKind = 'reply' | 'mention';

/**
 * `commentId` replied to a comment of `userId`, or mentioned them (`kind`). At most one per reader and
 * comment (unique index, migration 032). Unread while `readAt` is null.
 */
@Entity('notification')
@Index('UQ_notification_user_comment', ['userId', 'commentId'], { unique: true })
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 8, default: 'reply' })
  kind: NotificationKind;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  commentId: number;

  @ManyToOne(() => DiscussionComment, { onDelete: 'CASCADE' })
  comment: DiscussionComment;

  @Column()
  markerId: number;

  @Column('timestamp', { nullable: true })
  readAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
