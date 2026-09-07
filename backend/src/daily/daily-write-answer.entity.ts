import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';

/** One WRITE-card submission. Never updated — every submission is a new row, so a past
 *  answer is always shown next to a new one instead of being overwritten by it (mirrors
 *  the "Both answers are kept. Neither replaces the other." framing from the mockup). */
@Entity('daily_write_answer')
@Index(['userId', 'sourceId'])
export class DailyWriteAnswer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  /** The same sourceId the underlying concept's `concept-read`/`episode-watched` XP entry uses. */
  @Column()
  sourceId: string;

  @Column('text')
  text: string;

  @CreateDateColumn()
  createdAt: Date;
}
