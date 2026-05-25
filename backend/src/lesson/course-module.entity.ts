import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from './lesson.entity';

@Entity()
export class CourseModule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  order: number;

  @Column()
  title: string;

  @ManyToOne(() => Course, (c) => c.modules, { onDelete: 'CASCADE' })
  course: Course;

  @OneToMany(() => Lesson, (l) => l.module, { cascade: true, eager: true })
  lessons: Lesson[];
}
