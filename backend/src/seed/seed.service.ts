import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../course/course.entity';
import { CourseModule as CourseModuleEntity } from '../lesson/course-module.entity';
import { Lesson } from '../lesson/lesson.entity';
import { Exam } from '../exam/exam.entity';
import { Question } from '../exam/question.entity';
import { ALL_COURSES } from './course.data';
import { EXAMS, EXAM_QUESTIONS } from './exam.data';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger(SeedService.name);

  constructor(
    @InjectRepository(Course) private courseRepo: Repository<Course>,
    @InjectRepository(CourseModuleEntity) private moduleRepo: Repository<CourseModuleEntity>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
    @InjectRepository(Exam) private examRepo: Repository<Exam>,
    @InjectRepository(Question) private questionRepo: Repository<Question>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedCourses();
    await this.seedExams();
    await this.seedQuestions();
  }

  /**
   * Brings the courses in line with the course files on every boot, not only on the first one: a
   * lesson added to a file later (or a new title, order or content path) would otherwise never reach
   * a database that already has the course. Rows are matched by lesson id and by module order and
   * never deleted, so a reader's progress on a lesson stays valid.
   * ponytail: a lesson removed from the files stays in the database; delete it by hand or in a migration.
   */
  private async seedCourses() {
    for (const courseData of ALL_COURSES) {
      const known = await this.courseRepo.findOne({ where: { id: courseData.id } });
      if (!known) this.log.log(`Seeding course: ${courseData.title}`);

      const course = await this.courseRepo.save(
        this.courseRepo.create({
          id: courseData.id,
          title: courseData.title,
          tag: courseData.tag,
          audience: courseData.audience,
          moduleCount: courseData.moduleCount,
          duration: courseData.duration,
          description: courseData.description,
          benefits: courseData.benefits,
        }),
      );

      const knownModules = known?.modules ?? [];
      const modules = await this.moduleRepo.save(
        courseData.modules.map((mod: any) =>
          this.moduleRepo.create({
            id: knownModules.find((m) => m.order === mod.id)?.id,
            order: mod.id,
            title: mod.title,
            course,
          }),
        ),
      );

      const lessons = courseData.modules.flatMap((mod: any, moduleIndex: number) =>
        mod.lessons.map((lesson: any, i: number) => {
          const lessonEntity = new Lesson();
          lessonEntity.id = lesson.id;
          lessonEntity.title = lesson.title;
          lessonEntity.duration = lesson.duration;
          lessonEntity.type = (lesson.type === 'video' ? 'slide' : lesson.type) as Lesson['type'];
          lessonEntity.status = lesson.status as Lesson['status'];
          lessonEntity.contentPath = lesson.contentPath ?? null;
          lessonEntity.topic = (lesson as any).topic ?? null;
          lessonEntity.order = i;
          lessonEntity.module = modules[moduleIndex];
          return lessonEntity;
        }),
      );
      await this.lessonRepo.save(lessons);

      if (!known) this.log.log(`Course seeded: ${courseData.id}`);
    }
  }

  private async seedExams() {
    for (const examData of EXAMS) {
      const exists = await this.examRepo.findOne({ where: { id: examData.id } });
      if (exists) {
        await this.examRepo.save({ ...exists, ...examData });
      } else {
        this.log.log(`Seeding exam: ${examData.title}`);
        await this.examRepo.save(this.examRepo.create(examData));
      }
    }
  }

  private async seedQuestions() {
    const count = await this.questionRepo.count();
    if (count > 0) return;

    this.log.log(`Seeding ${EXAM_QUESTIONS.length} exam questions…`);
    await this.questionRepo.save(EXAM_QUESTIONS.map((q) => this.questionRepo.create(q)));
    this.log.log('Questions seeded.');
  }
}
