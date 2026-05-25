import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Exam } from './exam.entity';

export type QuestionType = 'single' | 'multi';

@Entity()
export class Question {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  examId: string;

  @ManyToOne(() => Exam, (e) => e.questions)
  exam: Exam;

  @Column()
  topic: string;

  @Column('text')
  text: string;

  @Column('text', { nullable: true })
  code: string | null;

  @Column('jsonb')
  options: { key: string; text: string }[];

  @Column('jsonb')
  correctKeys: string[];

  @Column()
  type: QuestionType;

  @Column('text', { nullable: true })
  explanation: string | null;

  @Column('text', { nullable: true })
  source: string | null;
}
