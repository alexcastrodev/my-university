import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { LessonStatus } from '../lesson/lesson.entity';

@Entity()
export class Progress {
  @PrimaryColumn()
  lessonId: string;

  @Column({ default: 'new' })
  status: LessonStatus;

  @UpdateDateColumn()
  updatedAt: Date;
}
