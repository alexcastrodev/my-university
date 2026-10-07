import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { DiscussionMarker } from './discussion-marker.entity';

/**
 * One comment. A root (`parentId` null) opens a thread that its author owns; replies hang
 * off the root, one level deep. Only the root's author can accept a reply, which resolves the thread.
 */
@Entity('discussion_comment')
@Index('IDX_discussion_comment_marker', ['markerId'])
export class DiscussionComment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  markerId: number;

  @ManyToOne(() => DiscussionMarker, { onDelete: 'CASCADE' })
  marker: DiscussionMarker;

  @Column({ type: 'int', nullable: true })
  parentId: number | null;

  @ManyToOne(() => DiscussionComment, { onDelete: 'CASCADE', nullable: true })
  parent: DiscussionComment | null;

  /** Null once the author's account is gone: the text stays, the name does not. */
  @Column({ type: 'int', nullable: true })
  authorId: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  author: User | null;

  @Column('text')
  body: string;

  /** On a root only: the reply its author accepted. Set means the thread is resolved. */
  @Column({ type: 'int', nullable: true })
  acceptedReplyId: number | null;

  /** Soft delete, so a removed root keeps its replies. The body is blanked when this is set. */
  @Column('timestamp', { nullable: true })
  deletedAt: Date | null;

  @Column('timestamp', { nullable: true })
  editedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
