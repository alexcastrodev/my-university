import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as Sentry from '@sentry/nestjs';
import { Repository } from 'typeorm';
import { Course } from '../course/course.entity';
import { Lesson } from '../lesson/lesson.entity';
import { AlgorithmsConceptsService } from '../algorithms-concepts/algorithms-concepts.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { JvmConceptsService } from '../jvm-concepts/jvm-concepts.service';
import { QuarkusConceptsService } from '../quarkus-concepts/quarkus-concepts.service';
import { KubernetesConceptsService } from '../kubernetes-concepts/kubernetes-concepts.service';
import { RubyConceptsService } from '../ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../rubyonrails-concepts/rubyonrails-concepts.service';
import { DotNetConceptsService } from '../dotnet-concepts/dotnet-concepts.service';
import { CSharpConceptsService } from '../csharp-concepts/csharp-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { TestingConceptsService } from '../testing-concepts/testing-concepts.service';
import { ConceptSection } from '../shared/concept-content';
import {
  DEFAULT_LANGUAGE,
  Language,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
} from '../shared/language';
import { MeilisearchClient, SearchDocument } from './meilisearch.client';

export const SEARCH_RESULT_TYPES = [
  'course',
  'lesson',
  'java-minute',
  'java-concept',
  'jvm-concept',
  'curriculum-concept',
  'database-concept',
  'spring-concept',
  'system-design-concept',
  'testing-concept',
  'algorithms-concept',
  'ruby-concept',
  'rubyonrails-concept',
  'quarkus-concept',
  'kubernetes-concept',
  'dotnet-concept',
  'csharp-concept',
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

/** `type` arrives straight from the query string and is interpolated into a Meilisearch filter expression, so only known values get through. */
export function isSearchResultType(value: unknown): value is SearchResultType {
  return (SEARCH_RESULT_TYPES as readonly unknown[]).includes(value);
}

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
/** Mirrors the index's `pagination.maxTotalHits`: Meilisearch returns nothing past it. */
export const MAX_SEARCH_OFFSET = 1000;

export interface SearchResult {
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  url: string;
  /** Title with the matched terms wrapped in `HIGHLIGHT_START`/`HIGHLIGHT_END`. */
  highlightedTitle: string;
  /** A short window of the body around the best match, highlighted the same way; null when nothing in the body matched. */
  snippet: string | null;
  /** Language of the indexed version that matched (a page without a translation matches in English). */
  language: Language;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  /** Estimated number of hits for the current type filter. */
  total: number;
  /** Hits per type for the query, ignoring the type filter, so the filter pills can show counts. */
  facets: Partial<Record<SearchResultType, number>>;
}

export interface SearchOptions {
  type?: SearchResultType;
  lang?: Language;
  limit?: number;
  offset?: number;
}

/** Private-use code points, so a highlight marker can never collide with real content and the client can split on them without rendering HTML. */
export const HIGHLIGHT_START = '\uE000';
export const HIGHLIGHT_END = '\uE001';

/** "programming-computational-thinking" -> "Programming Computational Thinking" — a discipline slug has no separate human title stored on the backend (that mapping lives only in the frontend's static registry), so search subtitles derive one directly. */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Markdown syntax is noise for both matching and the snippet shown under a result, so the body is
 * flattened to prose (code stays, since searching for an identifier is a real use case; only the
 * fences and markup characters go).
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^```.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`|]+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionsText(sections: ConceptSection[]): string {
  return toPlainText(
    sections.map((s) => `${s.title}\n${s.content}`).join('\n'),
  );
}

/** What every content track exposes for indexing, per language. */
interface IndexedEntry {
  slug: string;
  title: string;
  summary: string;
  sections: ConceptSection[];
  language: Language;
}

/** One indexable content track: how to list it in a language, and where its pages live. */
interface ContentSource {
  type: SearchResultType;
  /** Prefix for document ids; distinct per (module, discipline) for the curriculum. */
  idPrefix: string;
  subtitle: string;
  url: (slug: string) => string;
  list: (lang: Language) => IndexedEntry[];
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
    private curriculumService: CurriculumService,
    private databaseConceptsService: DatabaseConceptsService,
    private springConceptsService: SpringConceptsService,
    private systemDesignConceptsService: SystemDesignConceptsService,
    private testingConceptsService: TestingConceptsService,
    private algorithmsConceptsService: AlgorithmsConceptsService,
    private rubyConceptsService: RubyConceptsService,
    private rubyOnRailsConceptsService: RubyOnRailsConceptsService,
    private dotNetConceptsService: DotNetConceptsService,
    private cSharpConceptsService: CSharpConceptsService,
    private quarkusConceptsService: QuarkusConceptsService,
    private kubernetesConceptsService: KubernetesConceptsService,
    private meili: MeilisearchClient,
  ) {}

  /** Not awaited: the rebuild waits on every Meilisearch task, and blocking bootstrap on it would
   *  delay `listen()` past the container healthcheck's start period. Search keeps serving the
   *  previous index generation until the new one is swapped in. */
  onApplicationBootstrap() {
    void this.rebuildOnBoot();
  }

  /** One trace for the whole rebuild, instead of a stray root trace per Meilisearch call. */
  private rebuildOnBoot(): Promise<void> {
    return Sentry.startSpan(
      { name: 'search index rebuild', op: 'task', forceTransaction: true },
      async () => {
        try {
          await this.meili.waitUntilHealthy();
          await this.indexAll();
        } catch (err) {
          this.log.error(
            `Failed to build search index: ${(err as Error).message}`,
          );
        }
      },
    );
  }

  /** Every file-backed content track. Adding a track to the platform means adding it here, nothing else. */
  contentSources(): ContentSource[] {
    const concepts = (
      type: SearchResultType,
      subtitle: string,
      basePath: string,
      findAllDetailed: (lang: Language) => IndexedEntry[],
    ): ContentSource => ({
      type,
      idPrefix: type,
      subtitle,
      url: (slug) => `${basePath}/${slug}`,
      list: findAllDetailed,
    });

    const sources: ContentSource[] = [
      {
        type: 'java-minute',
        idPrefix: 'java-minute',
        subtitle: 'Java Minute',
        url: (slug) => `/java/java-minute/${slug}`,
        list: (lang) =>
          this.javaMinuteService.findAllDetailed(lang).map((episode) => ({
            slug: episode.slug,
            title: episode.question,
            summary: '',
            sections: episode.sections,
            language: episode.language,
          })),
      },
      concepts('java-concept', 'Java Concepts', '/java/java-concepts', (l) =>
        this.javaConceptsService.findAllDetailed(l),
      ),
      concepts('jvm-concept', 'JVM Concepts', '/java/jvm-concepts', (l) =>
        this.jvmConceptsService.findAllDetailed(l),
      ),
      concepts(
        'database-concept',
        'Database Concepts',
        '/databases/database-concepts',
        (l) => this.databaseConceptsService.findAllDetailed(l),
      ),
      concepts('spring-concept', 'Spring Concepts', '/spring-concepts', (l) =>
        this.springConceptsService.findAllDetailed(l),
      ),
      concepts(
        'system-design-concept',
        'System Design',
        '/system-design/system-design-concepts',
        (l) => this.systemDesignConceptsService.findAllDetailed(l),
      ),
      concepts('testing-concept', 'Testing Concepts', '/java/testing', (l) =>
        this.testingConceptsService.findAllDetailed(l),
      ),
      concepts(
        'algorithms-concept',
        'Algorithms',
        '/algorithms/algorithms-concepts',
        (l) => this.algorithmsConceptsService.findAllDetailed(l),
      ),
      concepts('ruby-concept', 'Ruby Concepts', '/ruby-concepts', (l) =>
        this.rubyConceptsService.findAllDetailed(l),
      ),
      concepts(
        'rubyonrails-concept',
        'Ruby on Rails Concepts',
        '/rubyonrails-concepts',
        (l) => this.rubyOnRailsConceptsService.findAllDetailed(l),
      ),
      concepts(
        'quarkus-concept',
        'Quarkus Concepts',
        '/quarkus-concepts',
        (l) => this.quarkusConceptsService.findAllDetailed(l),
      ),
      concepts(
        'kubernetes-concept',
        'Kubernetes Concepts',
        '/kubernetes-concepts',
        (l) => this.kubernetesConceptsService.findAllDetailed(l),
      ),
      concepts('dotnet-concept', '.NET Concepts', '/dotnet-concepts', (l) =>
        this.dotNetConceptsService.findAllDetailed(l),
      ),
      concepts('csharp-concept', 'C# Concepts', '/csharp-concepts', (l) =>
        this.cSharpConceptsService.findAllDetailed(l),
      ),
    ];

    for (const {
      module,
      discipline,
    } of this.curriculumService.listDisciplines()) {
      sources.push({
        type: 'curriculum-concept',
        idPrefix: `curriculum-concept-${module}-${discipline}`,
        subtitle: titleCase(discipline),
        url: (slug) => `/computer-science/${module}/${discipline}/${slug}`,
        list: (lang) =>
          this.curriculumService.findAllDetailed(module, discipline, lang),
      });
    }

    return sources;
  }

  /**
   * Builds one document per page per language it is actually written in. Each document carries
   * `visibleIn`: the languages whose searches should see it. A translation is visible only in its
   * own language; the English original is visible in English plus every language it has no
   * translation for. A search filtered on `visibleIn` therefore sees exactly one document per page
   * (no duplicates to collapse, and accurate per-type counts), in the searcher's language when it
   * exists. Translations also index the English title as `altTitle`, so searching the original
   * (often English, technical) name still finds the translated page.
   */
  buildContentDocuments(): SearchDocument[] {
    const documents: SearchDocument[] = [];

    for (const source of this.contentSources()) {
      const originals = source.list(DEFAULT_LANGUAGE);
      const translations = new Map<Language, Map<string, IndexedEntry>>();
      for (const language of SUPPORTED_LANGUAGES) {
        if (language === DEFAULT_LANGUAGE) continue;
        const bySlug = new Map<string, IndexedEntry>();
        for (const entry of source.list(language)) {
          // The services fall back to English when a translation is missing; that is not a translation.
          if (entry.language === language) bySlug.set(entry.slug, entry);
        }
        translations.set(language, bySlug);
      }

      for (const original of originals) {
        const translatedIn = [...translations.entries()]
          .filter(([, bySlug]) => bySlug.has(original.slug))
          .map(([language]) => language);

        documents.push({
          id: `${source.idPrefix}-${original.slug}`,
          type: source.type,
          title: original.title,
          altTitle: '',
          subtitle: source.subtitle,
          url: source.url(original.slug),
          summary: toPlainText(original.summary),
          content: sectionsText(original.sections),
          language: DEFAULT_LANGUAGE,
          visibleIn: SUPPORTED_LANGUAGES.filter(
            (language) => !translatedIn.includes(language),
          ),
        });

        for (const language of translatedIn) {
          const translated = translations.get(language)!.get(original.slug)!;
          documents.push({
            id: `${source.idPrefix}-${original.slug}-${language}`,
            type: source.type,
            title: translated.title,
            altTitle: translated.title === original.title ? '' : original.title,
            subtitle: source.subtitle,
            url: source.url(original.slug),
            summary: toPlainText(translated.summary),
            content: sectionsText(translated.sections),
            language,
            visibleIn: [language],
          });
        }
      }
    }

    return documents;
  }

  async indexAll(): Promise<void> {
    const [courses, lessons] = await Promise.all([
      this.courseRepo.find(),
      this.lessonRepo.find({ relations: { module: { course: true } } }),
    ]);

    // Courses and lessons only exist in English, so they are visible to every language.
    const everywhere = [...SUPPORTED_LANGUAGES];
    const documents: SearchDocument[] = [];

    for (const course of courses) {
      documents.push({
        id: `course-${course.id}`,
        type: 'course',
        title: course.title,
        altTitle: '',
        subtitle: course.tag,
        url: `/java/exam/${course.id}`,
        summary: course.description ?? '',
        content: '',
        language: DEFAULT_LANGUAGE,
        visibleIn: everywhere,
      });
    }

    for (const lesson of lessons) {
      const courseId = lesson.module?.course?.id;
      if (!courseId) continue;
      documents.push({
        id: `lesson-${lesson.id}`,
        type: 'lesson',
        title: lesson.title,
        altTitle: '',
        subtitle: lesson.module?.course?.title ?? null,
        url: `/java/exam/${courseId}/lesson/${lesson.id}`,
        summary: '',
        content: '',
        language: DEFAULT_LANGUAGE,
        visibleIn: everywhere,
      });
    }

    documents.push(...this.buildContentDocuments());

    await this.meili.rebuildIndex(documents);
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResponse> {
    const term = query.trim();
    if (term.length < 2)
      return { query: term, results: [], total: 0, facets: {} };

    const lang = normalizeLanguage(options.lang);
    const type = isSearchResultType(options.type) ? options.type : undefined;
    const limit = clamp(
      options.limit,
      DEFAULT_SEARCH_LIMIT,
      1,
      MAX_SEARCH_LIMIT,
    );
    const offset = clamp(options.offset, 0, 0, MAX_SEARCH_OFFSET);

    // `lang` went through normalizeLanguage and `type` through isSearchResultType, so both are known literals.
    const languageFilter = `visibleIn = "${lang}"`;
    const filter = type
      ? [languageFilter, `type = "${type}"`]
      : [languageFilter];

    const { hits, total, facets } = await this.meili.search({
      query: term,
      filter,
      facetFilter: [languageFilter],
      limit,
      offset,
      highlightPreTag: HIGHLIGHT_START,
      highlightPostTag: HIGHLIGHT_END,
    });

    return {
      query: term,
      total,
      facets: Object.fromEntries(
        Object.entries(facets).filter(([key]) => isSearchResultType(key)),
      ),
      results: hits.map((hit) => ({
        type: hit.type as SearchResultType,
        title: hit.title,
        subtitle: hit.subtitle,
        url: hit.url,
        highlightedTitle: hit.highlightedTitle,
        snippet: hit.snippet,
        language: normalizeLanguage(hit.language),
      })),
    };
  }
}

/** Paging params come from the query string: anything missing or non-numeric gets `fallback`. */
function clamp(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
