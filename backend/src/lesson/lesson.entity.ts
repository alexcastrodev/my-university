import { Column, Entity, ManyToOne, PrimaryColumn } from 'typeorm';
import { CourseModule } from './course-module.entity';

export type LessonType = 'slide' | 'practice' | 'skill-check';
export type LessonStatus = 'new' | 'in-progress' | 'completed' | 'not-attempted';

@Entity()
export class Lesson {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  duration: string;

  @Column()
  type: LessonType;

  @Column({ default: 'new' })
  status: LessonStatus;

  @Column('text', { nullable: true })
  contentPath: string | null;

  @ManyToOne(() => CourseModule, (m) => m.lessons, { onDelete: 'CASCADE' })
  module: CourseModule;
}
