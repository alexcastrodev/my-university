import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { MeilisearchClient } from './meilisearch.client';

export type SearchResultType = 'course' | 'lesson' | 'java-minute' | 'java-concept';

export interface SearchResult {
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  url: string;
}

@Injectable()
export class SearchService implements OnApplicationBootstrap {
  private readonly log = new Logger(SearchService.name);

  constructor(
    @InjectRepository(Course) private courseRepo: Repository<Course>,
    @InjectRepository(Lesson) private lessonRepo: Repository<Lesson>,
    private javaConceptsService: JavaConceptsService,
    private javaMinuteService: JavaMinuteService,
    private meili: MeilisearchClient,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.meili.waitUntilHealthy();
      await this.meili.configureIndex();
      await this.indexAll();
    } catch (err) {
      this.log.error(`Failed to build search index: ${(err as Error).message}`);
    }
  }

  async indexAll(): Promise<void> {
    const [courses, lessons] = await Promise.all([
      this.courseRepo.find(),
      this.lessonRepo.find({ relations: { module: { course: true } } }),
    ]);

    const documents: Record<string, unknown>[] = [];

    for (const course of courses) {
      documents.push({
        id: `course-${course.id}`,
        type: 'course' satisfies SearchResultType,
        title: course.title,
        subtitle: course.tag,
        url: `/java/exam/${course.id}`,
        content: course.description,
      });
    }

    for (const lesson of lessons) {
      const courseId = lesson.module?.course?.id;
      if (!courseId) continue;
      documents.push({
        id: `lesson-${lesson.id}`,
        type: 'lesson' satisfies SearchResultType,
        title: lesson.title,
        subtitle: lesson.module?.course?.title ?? null,
        url: `/java/exam/${courseId}/lesson/${lesson.id}`,
        content: '',
      });
    }

    for (const episode of this.javaMinuteService.findAllDetailed()) {
      documents.push({
        id: `java-minute-${episode.slug}`,
        type: 'java-minute' satisfies SearchResultType,
        title: episode.question,
        subtitle: 'Java Minute',
        url: `/java/java-minute/${episode.slug}`,
        content: episode.sections.map((s) => `${s.title} ${s.content}`).join(' '),
      });
    }

    for (const concept of this.javaConceptsService.findAllDetailed()) {
      documents.push({
        id: `java-concept-${concept.slug}`,
        type: 'java-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Java Concepts',
        url: `/java/java-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    await this.meili.replaceDocuments(documents);
  }

  async search(query: string, type?: SearchResultType): Promise<SearchResult[]> {
    const term = query.trim();
    if (term.length < 2) return [];

    const filter = type ? `type = "${type}"` : undefined;
    const hits = await this.meili.search(term, filter);

    return hits.map((hit) => ({
      type: hit.type as SearchResultType,
      title: hit.title,
      subtitle: hit.subtitle,
      url: hit.url,
    }));
  }
}
