import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { DiscussionComment } from './discussion-comment.entity';

@Entity('discussion_vote')
@Unique('UQ_discussion_vote_scope', ['commentId', 'userId'])
export class DiscussionVote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  commentId: number;

  @ManyToOne(() => DiscussionComment, { onDelete: 'CASCADE' })
  comment: DiscussionComment;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
