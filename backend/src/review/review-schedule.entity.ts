import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../auth/user.entity';

/** Reuses the same sourceType values already written by XpService for read-tracking. */
export type ReviewSourceType = 'concept-read' | 'episode-watched';

@Entity('review_schedule')
export class ReviewSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  sourceType: ReviewSourceType;

  @Column()
  sourceId: string;

  @Column('float', { default: 2.5 })
  easeFactor: number;

  @Column({ default: 0 })
  intervalDays: number;

  @Column({ default: 0 })
  repetitions: number;

  @Column()
  dueAt: Date;

  @Column('timestamp', { nullable: true })
  lastReviewedAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
