import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { DiscussionComment } from './discussion-comment.entity';

/** Someone replied to a comment of `userId`. `commentId` is the reply; unread while `readAt` is null. */
@Entity('notification')
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

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
