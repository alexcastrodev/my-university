import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { Question } from './question.entity';
import { ExamAttempt } from './exam-attempt.entity';

export type ExamCategory = 'Language' | 'Database';

@Entity()
export class Exam {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column()
  category: ExamCategory;

  @Column()
  version: string;

  @Column({ default: 'Proctored Online' })
  delivery: string;

  @Column({ default: 'Multiple Choice' })
  format: string;

  @Column({ default: 120 })
  durationMinutes: number;

  @Column({ default: 50 })
  questionCount: number;

  @Column({ default: 68 })
  passingScore: number;

  @OneToMany(() => Question, (q) => q.exam)
  questions: Question[];

  @OneToMany(() => ExamAttempt, (a) => a.exam)
  attempts: ExamAttempt[];
}
