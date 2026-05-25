import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Exam } from './exam.entity';

@Entity()
export class ExamAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  examId: string;

  @ManyToOne(() => Exam, (e) => e.attempts)
  exam: Exam;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ nullable: true })
  finishedAt: Date;

  @Column({ default: 0 })
  score: number;

  @Column({ default: 0 })
  total: number;

  @Column('simple-json')
  answers: Record<number, string[]>;
}
