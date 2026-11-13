// The SitemapService wired the way sitemap-urls.spec.ts and content-links.spec.ts need it: real content
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlgorithmsConceptsService } from '../src/algorithms-concepts/algorithms-concepts.service';
import { CourseService } from '../src/course/course.service';
import { CSharpConceptsService } from '../src/csharp-concepts/csharp-concepts.service';
import { CSharpMinuteService } from '../src/csharp-minute/csharp-minute.service';
import { CurriculumService } from '../src/curriculum/curriculum.service';
import { DatabaseConceptsService } from '../src/database-concepts/database-concepts.service';
import { DotNetConceptsService } from '../src/dotnet-concepts/dotnet-concepts.service';
import { DotNetAiConceptsService } from '../src/dotnet-ai-concepts/dotnet-ai-concepts.service';
import { RustConceptsService } from '../src/rust-concepts/rust-concepts.service';
import { GoConceptsService } from '../src/go-concepts/go-concepts.service';
import { DotNetTestingConceptsService } from '../src/dotnet-testing-concepts/dotnet-testing-concepts.service';
import { ExamService } from '../src/exam/exam.service';
import { JavaConceptsService } from '../src/java-concepts/java-concepts.service';
import { JavaMinuteService } from '../src/java-minute/java-minute.service';
import { JvmConceptsService } from '../src/jvm-concepts/jvm-concepts.service';
import { KubernetesConceptsService } from '../src/kubernetes-concepts/kubernetes-concepts.service';
import { PapersCatalogService } from '../src/papers/papers-catalog.service';
import { QuarkusConceptsService } from '../src/quarkus-concepts/quarkus-concepts.service';
import { RubyConceptsService } from '../src/ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../src/rubyonrails-concepts/rubyonrails-concepts.service';
import { SitemapService } from '../src/sitemap/sitemap.service';
import { SpringConceptsService } from '../src/spring-concepts/spring-concepts.service';
import { SystemDesignConceptsService } from '../src/system-design-concepts/system-design-concepts.service';
import { TestingConceptsService } from '../src/testing-concepts/testing-concepts.service';

// A lesson links to the public papers by slug, so the stub lists the real ones next to its two samples.
const seedPapers = JSON.parse(
  readFileSync(join(__dirname, '../src/seed/data/papers/papers.json'), 'utf8'),
) as { slug: string }[];

// The content tracks read their files straight from disk; only the database-backed and the
// papers catalog services are stubbed, so this needs neither the API nor Postgres.
export const javaConcepts = new JavaConceptsService();
export const sitemap = new SitemapService(
  javaConcepts,
  new JvmConceptsService(),
  new DatabaseConceptsService(),
  new SpringConceptsService(),
  new SystemDesignConceptsService(),
  new TestingConceptsService(),
  new AlgorithmsConceptsService(),
  new JavaMinuteService(),
  new CSharpMinuteService(),
  {
    listExams: () => Promise.resolve([{ id: 'java-25' }]),
  } as unknown as ExamService,
  {
    findAll: () =>
      Promise.resolve([
        {
          id: 'java-25',
          modules: [
            {
              lessons: [
                { id: 'j25-0-1', type: 'slide' },
                { id: 'j25-0-2', type: 'slide' },
                { id: 'j25-0-9', type: 'skill-check' },
              ],
            },
          ],
        },
      ]),
  } as unknown as CourseService,
  new RubyConceptsService(),
  new RubyOnRailsConceptsService(),
  new DotNetConceptsService(),
  new CSharpConceptsService(),
  new DotNetTestingConceptsService(),
  new DotNetAiConceptsService(),
  new RustConceptsService(),
  new GoConceptsService(),
  new QuarkusConceptsService(),
  new KubernetesConceptsService(),
  {
    slugs: () => [
      {
        slug: 'translated-paper',
        updatedAt: '2026-01-02',
        languages: ['en', 'pt-BR'],
      },
      { slug: 'english-only-paper', updatedAt: null, languages: ['en'] },
      ...seedPapers.map(({ slug }) => ({ slug, updatedAt: null, languages: ['en', 'pt-BR'] })),
    ],
  } as unknown as PapersCatalogService,
  new CurriculumService(),
);
