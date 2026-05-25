import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { CourseModule } from '../lesson/course-module.entity';

@Entity()
export class Course {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column()
  tag: string;

  @Column()
  audience: string;

  @Column()
  moduleCount: number;

  @Column()
  duration: string;

  @Column('text')
  description: string;

  @Column('simple-json')
  benefits: string[];

  @OneToMany(() => CourseModule, (m) => m.course, { cascade: true, eager: true })
  modules: CourseModule[];
}
