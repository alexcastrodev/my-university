import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';

export type SearchResultType = 'course' | 'lesson' | 'java-minute' | 'java-concept';

export interface SearchResult {
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  url: string;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Course) private courseRepo: Repository<Course>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
    private javaConceptsService: JavaConceptsService,
    private javaMinuteService: JavaMinuteService,
  ) {}

  async search(query: string): Promise<SearchResult[]> {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    const [courses, lessons] = await Promise.all([
      this.courseRepo.find(),
      this.lessonRepo.find({ relations: { module: { course: true } } }),
    ]);

    const results: SearchResult[] = [];

    for (const course of courses) {
      if (course.title.toLowerCase().includes(term) || course.description.toLowerCase().includes(term)) {
        results.push({
          type: 'course',
          title: course.title,
          subtitle: course.tag,
          url: `/exam/${course.id}`,
        });
      }
    }

    for (const lesson of lessons) {
      if (lesson.title.toLowerCase().includes(term)) {
        const courseId = lesson.module?.course?.id;
        if (!courseId) continue;
        results.push({
          type: 'lesson',
          title: lesson.title,
          subtitle: lesson.module?.course?.title ?? null,
          url: `/exam/${courseId}/lesson/${lesson.id}`,
        });
      }
    }

    for (const episode of this.javaMinuteService.findAll()) {
      if (episode.question.toLowerCase().includes(term)) {
        results.push({
          type: 'java-minute',
          title: episode.question,
          subtitle: 'Java Minute',
          url: `/java-minute/${episode.slug}`,
        });
      }
    }

    for (const concept of this.javaConceptsService.findAll()) {
      if (
        concept.title.toLowerCase().includes(term) ||
        concept.summary.toLowerCase().includes(term)
      ) {
        results.push({
          type: 'java-concept',
          title: concept.title,
          subtitle: 'Java Concepts',
          url: `/java-concepts/${concept.slug}`,
        });
      }
    }

    return results;
  }
}
