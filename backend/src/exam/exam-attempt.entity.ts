import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Exam } from './exam.entity';
import { QuestionType } from './question.entity';

/**
 * Per-question grading, revealed only once an attempt has been submitted.
 * Includes a snapshot of the question's own content (text/code/options) so a
 * later "review this attempt" screen is self-contained — one fetch, no need
 * to re-request each question individually.
 */
export interface QuestionReview {
  id: number;
  topic: string;
  type: QuestionType;
  text: string;
  code: string | null;
  options: { key: string; text: string }[];
  given: string[];
  correctKeys: string[];
  correct: boolean;
  explanation: string | null;
  source: string | null;
}

@Entity()
export class ExamAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  examId: string;

  @ManyToOne(() => Exam, (e) => e.attempts)
  exam: Exam;

  @Column({ nullable: true })
  userId: number;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ nullable: true })
  finishedAt: Date;

  @Column({ default: 0 })
  score: number;

  @Column({ default: 0 })
  total: number;

  @Column('jsonb')
  answers: Record<number, string[]>;

  /** Snapshot of per-question grading taken at submit time; null for attempts submitted before this column existed. */
  @Column('jsonb', { nullable: true })
  review: QuestionReview[] | null;
}
