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

  @OneToMany(() => Question, (q) => q.exam)
  questions: Question[];

  @OneToMany(() => ExamAttempt, (a) => a.exam)
  attempts: ExamAttempt[];
}
