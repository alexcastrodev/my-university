import { Injectable } from '@nestjs/common';
import { AlgorithmsConceptsService } from '../algorithms-concepts/algorithms-concepts.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { ExamService } from '../exam/exam.service';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { JvmConceptsService } from '../jvm-concepts/jvm-concepts.service';
import { QuarkusConceptsService } from '../quarkus-concepts/quarkus-concepts.service';
import { RubyConceptsService } from '../ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../rubyonrails-concepts/rubyonrails-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { TestingConceptsService } from '../testing-concepts/testing-concepts.service';
import { Language } from '../shared/language';

export interface SitemapUrl {
  path: string;
  lastmod: string | null;
  changefreq?: 'daily' | 'weekly' | 'monthly';
  priority?: string;
  /** Other language versions of this same page, for hreflang. */
  alternates?: { lang: Language; path: string }[];
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
    private readonly exam: ExamService,
    private readonly rubyConcepts: RubyConceptsService,
    private readonly rubyOnRailsConcepts: RubyOnRailsConceptsService,
    private readonly quarkusConcepts: QuarkusConceptsService,
  ) {}

  async buildUrls(): Promise<SitemapUrl[]> {
    const urls: SitemapUrl[] = [
      { path: '/', lastmod: null, changefreq: 'weekly', priority: '1.0' },
    ];

    urls.push(
      ...this.localizedSectionUrls('/java/java-concepts', '/pt-BR/java/java-concepts', this.javaConcepts.findAll()),
    );
    urls.push(
      ...this.localizedSectionUrls('/java/jvm-concepts', '/pt-BR/java/jvm-concepts', this.jvmConcepts.findAll()),
    );
    urls.push(
      ...this.listSection(
        '/databases/database-concepts',
        this.databaseConcepts.findAll(),
      ),
    );
    urls.push(
      ...this.localizedSectionUrls('/spring-concepts', '/pt-BR/spring-concepts', this.springConcepts.findAll()),
    );
    urls.push(
      ...this.listSection(
        '/system-design/system-design-concepts',
        this.systemDesignConcepts.findAll(),
      ),
    );
    urls.push(
      ...this.listSection('/java/testing', this.testingConcepts.findAll()),
    );
    urls.push(
      ...this.listSection(
        '/algorithms/algorithms-concepts',
        this.algorithmsConcepts.findAll(),
      ),
    );
    urls.push(
      ...this.localizedSectionUrls('/java/java-minute', '/pt-BR/java/java-minute', this.javaMinute.findAll()),
    );
    urls.push(
      ...this.listSection('/ruby-concepts', this.rubyConcepts.findAll()),
    );
    urls.push(
      ...this.listSection(
        '/rubyonrails-concepts',
        this.rubyOnRailsConcepts.findAll(),
      ),
    );
    urls.push(
      ...this.listSection('/quarkus-concepts', this.quarkusConcepts.findAll()),
    );

    const exams = await this.exam.listExams();
    urls.push({
      path: '/java/exams',
      lastmod: null,
      changefreq: 'weekly',
      priority: '0.8',
    });
    for (const exam of exams) {
      urls.push({
        path: `/java/exam/${exam.id}`,
        lastmod: null,
        changefreq: 'monthly',
        priority: '0.6',
      });
    }

    return urls;
  }

  private listSection(
    basePath: string,
    items: { slug: string; publishedAt: string }[],
  ): SitemapUrl[] {
    const urls: SitemapUrl[] = [
      { path: basePath, lastmod: null, changefreq: 'weekly', priority: '0.8' },
    ];
    for (const item of items) {
      urls.push({
        path: `${basePath}/${item.slug}`,
        lastmod: item.publishedAt,
        changefreq: 'monthly',
        priority: '0.6',
      });
    }
    return urls;
  }

  /** For a section with real pt-BR translations: emits both locale-prefixed URLs and reciprocal hreflang alternates, only for items that actually have a pt-BR version. */
  private localizedSectionUrls(
    enBase: string,
    ptBrBase: string,
    items: { slug: string; publishedAt: string; availableLanguages: Language[] }[],
  ): SitemapUrl[] {
    const urls: SitemapUrl[] = [
      {
        path: enBase,
        lastmod: null,
        changefreq: 'weekly',
        priority: '0.8',
        alternates: [{ lang: 'pt-BR', path: ptBrBase }],
      },
      {
        path: ptBrBase,
        lastmod: null,
        changefreq: 'weekly',
        priority: '0.8',
        alternates: [{ lang: 'en', path: enBase }],
      },
    ];

    for (const item of items) {
      const hasPtBr = item.availableLanguages.includes('pt-BR');
      urls.push({
        path: `${enBase}/${item.slug}`,
        lastmod: item.publishedAt,
        changefreq: 'monthly',
        priority: '0.6',
        ...(hasPtBr && { alternates: [{ lang: 'pt-BR', path: `${ptBrBase}/${item.slug}` }] }),
      });
      if (hasPtBr) {
        urls.push({
          path: `${ptBrBase}/${item.slug}`,
          lastmod: item.publishedAt,
          changefreq: 'monthly',
          priority: '0.6',
          alternates: [{ lang: 'en', path: `${enBase}/${item.slug}` }],
        });
      }
    }

    return urls;
  }

  async toXml(): Promise<string> {
    const urls = await this.buildUrls();
    const entries = urls
      .map((url) => {
        const loc = `${SITE_ORIGIN}${url.path}`;
        const lastmod = url.lastmod
          ? `\n    <lastmod>${this.toDate(url.lastmod)}</lastmod>`
          : '';
        const changefreq = url.changefreq
          ? `\n    <changefreq>${url.changefreq}</changefreq>`
          : '';
        const priority = url.priority
          ? `\n    <priority>${url.priority}</priority>`
          : '';
        const alternates = (url.alternates ?? [])
          .map(
            (alt) =>
              `\n    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${this.escape(`${SITE_ORIGIN}${alt.path}`)}" />`,
          )
          .join('');
        return `  <url>\n    <loc>${this.escape(loc)}</loc>${lastmod}${changefreq}${priority}${alternates}\n  </url>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries}\n</urlset>\n`;
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
      .replace(/>/g, '&gt;');
  }
}
