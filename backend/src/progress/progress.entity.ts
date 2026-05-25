import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { LessonStatus } from '../lesson/lesson.entity';

@Entity('user_lesson_progress')
@Index(['userId', 'courseId', 'lessonId'], { unique: true })
export class Progress {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column()
  courseId: string;

  @Column()
  lessonId: string;

  @Column({ default: 'new' })
  status: LessonStatus;

  @UpdateDateColumn()
  updatedAt: Date;
}
