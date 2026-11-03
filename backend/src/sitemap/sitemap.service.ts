import { Injectable } from '@nestjs/common';
import { AlgorithmsConceptsService } from '../algorithms-concepts/algorithms-concepts.service';
import { CourseService } from '../course/course.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { ExamService } from '../exam/exam.service';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { CSharpMinuteService } from '../csharp-minute/csharp-minute.service';
import { JvmConceptsService } from '../jvm-concepts/jvm-concepts.service';
import { QuarkusConceptsService } from '../quarkus-concepts/quarkus-concepts.service';
import { PapersCatalogService } from '../papers/papers-catalog.service';
import { KubernetesConceptsService } from '../kubernetes-concepts/kubernetes-concepts.service';
import { RubyConceptsService } from '../ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../rubyonrails-concepts/rubyonrails-concepts.service';
import { DotNetConceptsService } from '../dotnet-concepts/dotnet-concepts.service';
import { CSharpConceptsService } from '../csharp-concepts/csharp-concepts.service';
import { DotNetTestingConceptsService } from '../dotnet-testing-concepts/dotnet-testing-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { TestingConceptsService } from '../testing-concepts/testing-concepts.service';
import { CONTENT_CACHE_ENABLED } from '../shared/concept-content';
import { Language } from '../shared/language';

export interface SitemapUrl {
  path: string;
  lastmod: string | null;
  /** Every language version of this page, itself included (a sitemap needs the full set on each URL). The English one is also the x-default. */
  alternates?: { lang: Language; path: string }[];
}

/** What a section needs from one of its pages: the slug, when it last changed, and which translations exist. */
interface SectionItem {
  slug: string;
  publishedAt: string | null;
  updatedAt?: string | null;
  availableLanguages: Language[];
}

const SITE_ORIGIN = 'https://university.kurz.fyi';

@Injectable()
export class SitemapService {
  constructor(
    private readonly javaConcepts: JavaConceptsService,
    private readonly jvmConcepts: JvmConceptsService,
    private readonly databaseConcepts: DatabaseConceptsService,
    private readonly springConcepts: SpringConceptsService,
    private readonly systemDesignConcepts: SystemDesignConceptsService,
    private readonly testingConcepts: TestingConceptsService,
    private readonly algorithmsConcepts: AlgorithmsConceptsService,
    private readonly javaMinute: JavaMinuteService,
    private readonly cSharpMinute: CSharpMinuteService,
    private readonly exam: ExamService,
    private readonly courses: CourseService,
    private readonly rubyConcepts: RubyConceptsService,
    private readonly rubyOnRailsConcepts: RubyOnRailsConceptsService,
    private readonly dotNetConcepts: DotNetConceptsService,
    private readonly cSharpConcepts: CSharpConceptsService,
    private readonly dotNetTestingConcepts: DotNetTestingConceptsService,
    private readonly quarkusConcepts: QuarkusConceptsService,
    private readonly kubernetesConcepts: KubernetesConceptsService,
    private readonly papers: PapersCatalogService,
    private readonly curriculum: CurriculumService,
  ) {}

  async buildUrls(): Promise<SitemapUrl[]> {
    // Pages made of interface text only, translated in full.
    const urls: SitemapUrl[] = ['/', '/tracks', '/computer-science'].flatMap(
      (path) => this.localizedPage(path),
    );

    // Every section is a list page plus one page per item, each with a pt-BR twin where the translation exists.
    // The public papers are authored files with a translation each (#213); a reader's private papers are not listed.
    const sections: [string, SectionItem[]][] = [
      [
        '/papers',
        this.papers.slugs().map(({ slug, updatedAt, languages }) => ({
          slug,
          publishedAt: updatedAt,
          availableLanguages: languages,
        })),
      ],
      ['/java/java-concepts', this.javaConcepts.findAll()],
      ['/java/jvm-concepts', this.jvmConcepts.findAll()],
      ['/databases/database-concepts', this.databaseConcepts.findAll()],
      ['/spring-concepts', this.springConcepts.findAll()],
      [
        '/system-design/system-design-concepts',
        this.systemDesignConcepts.findAll(),
      ],
      ['/java/testing', this.testingConcepts.findAll()],
      ['/algorithms/algorithms-concepts', this.algorithmsConcepts.findAll()],
      ['/java/java-minute', this.javaMinute.findAll()],
      ['/ruby-concepts', this.rubyConcepts.findAll()],
      ['/rubyonrails-concepts', this.rubyOnRailsConcepts.findAll()],
      ['/dotnet-concepts', this.dotNetConcepts.findAll()],
      ['/csharp-concepts', this.cSharpConcepts.findAll()],
      ['/dotnet-testing-concepts', this.dotNetTestingConcepts.findAll()],
      ['/csharp-minute', this.cSharpMinute.findAll()],
      ['/quarkus-concepts', this.quarkusConcepts.findAll()],
      ['/kubernetes-concepts', this.kubernetesConcepts.findAll()],
    ];
    for (const {
      module: mod,
      discipline,
    } of this.curriculum.listDisciplines()) {
      sections.push([
        `/computer-science/${mod}/${discipline}`,
        this.curriculum.findAll(mod, discipline),
      ]);
    }
    for (const [base, items] of sections) {
      urls.push(...this.localizedSectionUrls(base, items));
    }

    urls.push({ path: '/java/exams', lastmod: null });
    for (const exam of await this.exam.listExams()) {
      urls.push({ path: `/java/exam/${exam.id}`, lastmod: null });
    }
    // The lessons are server-rendered, indexable pages, but the course page links to them from the browser only.
    // A skill check is left out: its questions are drawn in the browser, so the page has no text of its own.
    for (const course of await this.courses.findAll()) {
      for (const mod of course.modules) {
        for (const lesson of mod.lessons.filter(
          (l) => l.type !== 'skill-check',
        )) {
          urls.push({
            path: `/java/exam/${course.id}/lesson/${lesson.id}`,
            lastmod: null,
          });
        }
      }
    }

    return urls;
  }

  /**
   * The list page and every item of a section, in English and in pt-BR. An item gets a pt-BR URL only
   * if its pt-BR file exists (the app never serves the English fallback as its own page), and both
   * versions list each other, themselves included.
   */
  private localizedSectionUrls(
    enBase: string,
    items: SectionItem[],
  ): SitemapUrl[] {
    const urls = this.localizedPage(enBase);

    for (const item of items) {
      const lastmod = item.updatedAt ?? item.publishedAt;
      const en = `${enBase}/${item.slug}`;
      if (!item.availableLanguages.includes('pt-BR')) {
        urls.push({ path: en, lastmod });
        continue;
      }
      urls.push(...this.localizedPage(en, lastmod));
    }

    return urls;
  }

  /** A page and its pt-BR twin (`/pt-BR` + path, so the home is `/pt-BR/`), each listing both. */
  private localizedPage(
    enPath: string,
    lastmod: string | null = null,
  ): SitemapUrl[] {
    const ptBrPath = `/pt-BR${enPath}`;
    const alternates = [
      { lang: 'en' as const, path: enPath },
      { lang: 'pt-BR' as const, path: ptBrPath },
    ];
    return [
      { path: enPath, lastmod, alternates },
      { path: ptBrPath, lastmod, alternates },
    ];
  }

  /** The XML for the life of the process, built on first request (see `toXml`). */
  private cachedXml: Promise<string> | null = null;

  /**
   * Everything the sitemap lists (content files, seeded exams) only changes with a deploy, and
   * building it walks every track (~250 ms in production traces), so it is built once per process.
   * Outside production it is rebuilt each time, like the content cache, so edits show up at once.
   */
  toXml(): Promise<string> {
    if (!CONTENT_CACHE_ENABLED) return this.buildXml();
    this.cachedXml ??= this.buildXml().catch((err: unknown) => {
      this.cachedXml = null; // don't pin a failed build (e.g. DB hiccup) until the next deploy
      throw err;
    });
    return this.cachedXml;
  }

  private async buildXml(): Promise<string> {
    const urls = await this.buildUrls();
    const entries = urls
      .map((url) => {
        const lastmod = url.lastmod
          ? `\n    <lastmod>${this.toDate(url.lastmod)}</lastmod>`
          : '';
        const alternates = this.withXDefault(url.alternates)
          .map(
            (alt) =>
              `\n    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${this.escape(`${SITE_ORIGIN}${alt.path}`)}" />`,
          )
          .join('');
        return `  <url>\n    <loc>${this.escape(`${SITE_ORIGIN}${url.path}`)}</loc>${lastmod}${alternates}\n  </url>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries}\n</urlset>\n`;
  }

  /** The unprefixed (English) URL is also the x-default, like the `<link rel="alternate">` the pages write. */
  private withXDefault(
    alternates: SitemapUrl['alternates'] = [],
  ): { lang: string; path: string }[] {
    const en = alternates.find((alt) => alt.lang === 'en');
    return en
      ? [...alternates, { lang: 'x-default', path: en.path }]
      : alternates;
  }

  private toDate(isoLike: string): string {
    const date = new Date(isoLike);
    return Number.isNaN(date.getTime())
      ? isoLike
      : date.toISOString().slice(0, 10);
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
