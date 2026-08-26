import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { AlgorithmsConceptsService } from '../algorithms-concepts/algorithms-concepts.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { JvmConceptsService } from '../jvm-concepts/jvm-concepts.service';
import { QuarkusConceptsService } from '../quarkus-concepts/quarkus-concepts.service';
import { RubyConceptsService } from '../ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../rubyonrails-concepts/rubyonrails-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { TestingConceptsService } from '../testing-concepts/testing-concepts.service';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '../shared/language';
import { MeilisearchClient } from './meilisearch.client';

export type SearchResultType =
  | 'course'
  | 'lesson'
  | 'java-minute'
  | 'java-concept'
  | 'jvm-concept'
  | 'database-concept'
  | 'spring-concept'
  | 'system-design-concept'
  | 'testing-concept'
  | 'algorithms-concept'
  | 'ruby-concept'
  | 'rubyonrails-concept'
  | 'quarkus-concept';

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
    private jvmConceptsService: JvmConceptsService,
    private javaMinuteService: JavaMinuteService,
    private databaseConceptsService: DatabaseConceptsService,
    private springConceptsService: SpringConceptsService,
    private systemDesignConceptsService: SystemDesignConceptsService,
    private testingConceptsService: TestingConceptsService,
    private algorithmsConceptsService: AlgorithmsConceptsService,
    private rubyConceptsService: RubyConceptsService,
    private rubyOnRailsConceptsService: RubyOnRailsConceptsService,
    private quarkusConceptsService: QuarkusConceptsService,
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

    // Also index each non-English translation that actually exists, so searching in that
    // language finds it too. English above keeps its original id; translations get a
    // language-suffixed id so they're purely additive (no stale docs from an id rename).
    for (const language of SUPPORTED_LANGUAGES) {
      if (language === DEFAULT_LANGUAGE) continue;
      for (const episode of this.javaMinuteService.findAllDetailed(language)) {
        if (episode.language !== language) continue; // no translation for this slug — already indexed as English
        documents.push({
          id: `java-minute-${episode.slug}-${language}`,
          type: 'java-minute' satisfies SearchResultType,
          title: episode.question,
          subtitle: 'Java Minute',
          url: `/java/java-minute/${episode.slug}`,
          content: episode.sections.map((s) => `${s.title} ${s.content}`).join(' '),
        });
      }
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

    for (const concept of this.jvmConceptsService.findAllDetailed()) {
      documents.push({
        id: `jvm-concept-${concept.slug}`,
        type: 'jvm-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'JVM Concepts',
        url: `/java/jvm-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.databaseConceptsService.findAllDetailed()) {
      documents.push({
        id: `database-concept-${concept.slug}`,
        type: 'database-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Database Concepts',
        url: `/databases/database-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.springConceptsService.findAllDetailed()) {
      documents.push({
        id: `spring-concept-${concept.slug}`,
        type: 'spring-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Spring Concepts',
        url: `/spring-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.systemDesignConceptsService.findAllDetailed()) {
      documents.push({
        id: `system-design-concept-${concept.slug}`,
        type: 'system-design-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'System Design',
        url: `/system-design/system-design-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.testingConceptsService.findAllDetailed()) {
      documents.push({
        id: `testing-concept-${concept.slug}`,
        type: 'testing-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Testing Concepts',
        url: `/java/testing/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.algorithmsConceptsService.findAllDetailed()) {
      documents.push({
        id: `algorithms-concept-${concept.slug}`,
        type: 'algorithms-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Algorithms',
        url: `/algorithms/algorithms-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.rubyConceptsService.findAllDetailed()) {
      documents.push({
        id: `ruby-concept-${concept.slug}`,
        type: 'ruby-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Ruby Concepts',
        url: `/ruby-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.rubyOnRailsConceptsService.findAllDetailed()) {
      documents.push({
        id: `rubyonrails-concept-${concept.slug}`,
        type: 'rubyonrails-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Ruby on Rails Concepts',
        url: `/rubyonrails-concepts/${concept.slug}`,
        content: [concept.summary, ...concept.sections.map((s) => `${s.title} ${s.content}`)].join(' '),
      });
    }

    for (const concept of this.quarkusConceptsService.findAllDetailed()) {
      documents.push({
        id: `quarkus-concept-${concept.slug}`,
        type: 'quarkus-concept' satisfies SearchResultType,
        title: concept.title,
        subtitle: 'Quarkus Concepts',
        url: `/quarkus-concepts/${concept.slug}`,
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

    // Content indexed in multiple languages (e.g. Java Minute) can produce more than one hit
    // for the same page — keep only the highest-ranked (first) one per url.
    const seenUrls = new Set<string>();
    const deduped = hits.filter((hit) => {
      if (seenUrls.has(hit.url)) return false;
      seenUrls.add(hit.url);
      return true;
    });

    return deduped.map((hit) => ({
      type: hit.type as SearchResultType,
      title: hit.title,
      subtitle: hit.subtitle,
      url: hit.url,
    }));
  }
}
