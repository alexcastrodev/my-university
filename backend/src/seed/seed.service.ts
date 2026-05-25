import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../course/course.entity';
import { CourseModule as CourseModuleEntity } from '../lesson/course-module.entity';
import { Lesson } from '../lesson/lesson.entity';
import { Exam } from '../exam/exam.entity';
import { Question } from '../exam/question.entity';
import { COURSE_DATA } from './course.data';
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
    await this.seedCourse();
    await this.seedExams();
    await this.seedQuestions();
  }

  private async seedCourse() {
    const exists = await this.courseRepo.findOne({ where: { id: COURSE_DATA.id } });
    if (exists) return;

    this.log.log('Seeding course data…');
    const course = this.courseRepo.create({
      id: COURSE_DATA.id,
      title: COURSE_DATA.title,
      tag: COURSE_DATA.tag,
      audience: COURSE_DATA.audience,
      moduleCount: COURSE_DATA.moduleCount,
      duration: COURSE_DATA.duration,
      description: COURSE_DATA.description,
      benefits: COURSE_DATA.benefits,
    });
    await this.courseRepo.save(course);

    for (const mod of COURSE_DATA.modules) {
      const moduleEntity = this.moduleRepo.create({
        order: mod.id,
        title: mod.title,
        course,
      });
      await this.moduleRepo.save(moduleEntity);

      for (const lesson of mod.lessons) {
        const lessonEntity = new Lesson();
        lessonEntity.id = lesson.id;
        lessonEntity.title = lesson.title;
        lessonEntity.duration = lesson.duration;
        lessonEntity.type = (lesson.type === 'video' ? 'slide' : lesson.type) as Lesson['type'];
        lessonEntity.status = lesson.status as Lesson['status'];
        lessonEntity.content = null;
        lessonEntity.module = moduleEntity;
        await this.lessonRepo.save(lessonEntity);
      }
    }
    this.log.log('Course seeded.');
  }

  private async seedExams() {
    for (const examData of EXAMS) {
      const exists = await this.examRepo.findOne({ where: { id: examData.id } });
      if (exists) continue;
      this.log.log(`Seeding exam: ${examData.title}`);
      await this.examRepo.save(this.examRepo.create(examData));
    }
  }

  private async seedQuestions() {
    const count = await this.questionRepo.count();
    if (count > 0) return;

    this.log.log(`Seeding ${EXAM_QUESTIONS.length} exam questions…`);
    for (const q of EXAM_QUESTIONS) {
      await this.questionRepo.save(this.questionRepo.create(q));
    }
    this.log.log('Questions seeded.');
  }
}
