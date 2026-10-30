import { Injectable } from '@nestjs/common';
import { ConceptSection } from '../shared/concept-content';
import { AlgorithmsConceptsService } from '../algorithms-concepts/algorithms-concepts.service';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JvmConceptsService } from '../jvm-concepts/jvm-concepts.service';
import { QuarkusConceptsService } from '../quarkus-concepts/quarkus-concepts.service';
import { KubernetesConceptsService } from '../kubernetes-concepts/kubernetes-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { CSharpMinuteService } from '../csharp-minute/csharp-minute.service';
import { TestingConceptsService } from '../testing-concepts/testing-concepts.service';
import { RubyConceptsService } from '../ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../rubyonrails-concepts/rubyonrails-concepts.service';
import { DotNetConceptsService } from '../dotnet-concepts/dotnet-concepts.service';
import { CSharpConceptsService } from '../csharp-concepts/csharp-concepts.service';
import { DotNetTestingConceptsService } from '../dotnet-testing-concepts/dotnet-testing-concepts.service';
import { DotNetAiConceptsService } from '../dotnet-ai-concepts/dotnet-ai-concepts.service';
import { curriculumSourceId, fromSourceId, parseCurriculumSourceId, ResolvedCurriculum, ResolvedSource, ConceptSourceType, toSourceId } from './concept-lookup.constants';
import { XpService } from '../xp/xp.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { toUtcDateKey } from '../xp/streak';
import { Language } from '../shared/language';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecentActivityItem {
  date: string;
  module: string;
  slug: string;
  title: string;
  route: string[];
  exp: number;
}

@Injectable()
export class ConceptLookupService {
  constructor(
    private xp: XpService,
    private javaConcepts: JavaConceptsService,
    private jvmConcepts: JvmConceptsService,
    private springConcepts: SpringConceptsService,
    private databaseConcepts: DatabaseConceptsService,
    private systemDesignConcepts: SystemDesignConceptsService,
    private javaMinute: JavaMinuteService,
    private cSharpMinute: CSharpMinuteService,
    private testingConcepts: TestingConceptsService,
    private algorithmsConcepts: AlgorithmsConceptsService,
    private rubyConcepts: RubyConceptsService,
    private rubyOnRailsConcepts: RubyOnRailsConceptsService,
    private dotNetConcepts: DotNetConceptsService,
    private cSharpConcepts: CSharpConceptsService,
    private dotNetTestingConcepts: DotNetTestingConceptsService,
    private dotNetAiConcepts: DotNetAiConceptsService,
    private quarkusConcepts: QuarkusConceptsService,
    private kubernetesConcepts: KubernetesConceptsService,
    private curriculum: CurriculumService,
  ) {}

  /** Module -> slug -> human title, for every Complementary Studies area — the single lookup
   *  `getRecentActivity` resolves a sourceId's display title through. */
  private buildTitlesByModule(): Record<string, Map<string, string>> {
    return {
      'java-concepts': new Map(this.javaConcepts.findAll().map((c) => [c.slug, c.title])),
      'jvm-concepts': new Map(this.jvmConcepts.findAll().map((c) => [c.slug, c.title])),
      'spring-concepts': new Map(this.springConcepts.findAll().map((c) => [c.slug, c.title])),
      'database-concepts': new Map(this.databaseConcepts.findAll().map((c) => [c.slug, c.title])),
      'system-design-concepts': new Map(this.systemDesignConcepts.findAll().map((c) => [c.slug, c.title])),
      'java-minute': new Map(this.javaMinute.findAll().map((e) => [e.slug, e.question])),
      'csharp-minute': new Map(this.cSharpMinute.findAll().map((e) => [e.slug, e.question])),
      'testing-concepts': new Map(this.testingConcepts.findAll().map((c) => [c.slug, c.title])),
      'algorithms-concepts': new Map(this.algorithmsConcepts.findAll().map((c) => [c.slug, c.title])),
      'ruby-concepts': new Map(this.rubyConcepts.findAll().map((c) => [c.slug, c.title])),
      'rubyonrails-concepts': new Map(this.rubyOnRailsConcepts.findAll().map((c) => [c.slug, c.title])),
      'dotnet-concepts': new Map(this.dotNetConcepts.findAll().map((c) => [c.slug, c.title])),
      'csharp-concepts': new Map(this.cSharpConcepts.findAll().map((c) => [c.slug, c.title])),
      'dotnet-testing-concepts': new Map(this.dotNetTestingConcepts.findAll().map((c) => [c.slug, c.title])),
      'dotnet-ai-concepts': new Map(this.dotNetAiConcepts.findAll().map((c) => [c.slug, c.title])),
      'quarkus-concepts': new Map(this.quarkusConcepts.findAll().map((c) => [c.slug, c.title])),
      'kubernetes-concepts': new Map(this.kubernetesConcepts.findAll().map((c) => [c.slug, c.title])),
    };
  }

  /** Full content (title + sections) for one module's concept, or undefined if the module
   *  isn't a recognized Complementary Studies area or the slug doesn't resolve — the
   *  per-module fan-out `buildTitlesByModule` also needs, but returning the whole detail
   *  instead of just a title, and looked up by slug directly instead of pre-loading every
   *  concept in the module. `java-minute` has no `title` field (its detail exposes
   *  `question` instead), handled the same way `buildTitlesByModule` already does. */
  private conceptDetailByModule(
    module: string,
    slug: string,
    lang?: Language,
  ): { title: string; sections: ConceptSection[] } | undefined {
    switch (module) {
      case 'java-concepts': {
        const d = this.javaConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'jvm-concepts': {
        const d = this.jvmConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'spring-concepts': {
        const d = this.springConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'database-concepts': {
        const d = this.databaseConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'system-design-concepts': {
        const d = this.systemDesignConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'java-minute': {
        const d = this.javaMinute.findBySlug(slug, lang);
        return d ? { title: d.question, sections: d.sections } : undefined;
      }
      case 'csharp-minute': {
        const d = this.cSharpMinute.findBySlug(slug, lang);
        return d ? { title: d.question, sections: d.sections } : undefined;
      }
      case 'testing-concepts': {
        const d = this.testingConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'algorithms-concepts': {
        const d = this.algorithmsConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'ruby-concepts': {
        const d = this.rubyConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'rubyonrails-concepts': {
        const d = this.rubyOnRailsConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'dotnet-concepts': {
        const d = this.dotNetConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'csharp-concepts': {
        const d = this.cSharpConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'dotnet-testing-concepts': {
        const d = this.dotNetTestingConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'dotnet-ai-concepts': {
        const d = this.dotNetAiConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'quarkus-concepts': {
        const d = this.quarkusConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'kubernetes-concepts': {
        const d = this.kubernetesConcepts.findBySlug(slug, lang);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      default:
        return undefined;
    }
  }

  /**
   * Full content behind a sourceId: the same resolution `getRecentActivity`
   * do for a display title, but returning `sections` too. The discussion features read concept
   * content through this one seam instead of re-importing every concept module themselves.
   */
  resolveConceptDetail(
    sourceType: ConceptSourceType,
    sourceId: string,
    lang?: Language,
  ): { title: string; sections: ConceptSection[]; route: string[] } | null {
    const cc = parseCurriculumSourceId(sourceId);
    if (cc) {
      const detail = this.curriculum.findBySlug(cc.module, cc.discipline, cc.slug, lang);
      if (!detail) return null;
      return { title: detail.title, sections: detail.sections, route: cc.route };
    }

    const resolved = fromSourceId(sourceType, sourceId);
    if (!resolved) return null;
    const detail = this.conceptDetailByModule(resolved.module, resolved.slug, lang);
    if (!detail) return null;
    return { title: detail.title, sections: detail.sections, route: resolved.route };
  }

  /** module + slug (+ discipline for Computer Science) -> the sourceType/sourceId identity the XP
   *  and discussion features share; null when the module is unknown or the concept is gone. */
  resolveTopic(module: string, slug: string, discipline?: string): ResolvedSource | null {
    if (!discipline) return toSourceId(module, slug);
    if (!this.curriculum.findBySlug(module, discipline, slug)) return null;
    return { sourceType: 'concept-read', sourceId: curriculumSourceId(module, discipline, slug) };
  }

  /** Human title for a Computer Science curriculum concept, or undefined if its discipline/content
   *  was removed since the review was scheduled . */
  private curriculumTitle(cc: ResolvedCurriculum): string | undefined {
    try {
      return this.curriculum.findBySlug(cc.module, cc.discipline, cc.slug)?.title;
    } catch {
      return undefined;
    }
  }

  async getRecentActivity(userId: number, days = 7): Promise<RecentActivityItem[]> {
    const since = new Date(Date.now() - days * DAY_MS);
    const entries = await this.xp.getHistorySince(userId, since);
    const titlesByModule = this.buildTitlesByModule();

    const items: RecentActivityItem[] = [];
    for (const entry of entries) {
      if (entry.sourceType !== 'concept-read' && entry.sourceType !== 'episode-watched') continue;

      const cc = parseCurriculumSourceId(entry.sourceId);
      if (cc) {
        const title = this.curriculumTitle(cc);
        if (title === undefined) continue;
        items.push({
          date: toUtcDateKey(entry.updatedAt),
          module: cc.module,
          slug: cc.slug,
          title,
          route: cc.route,
          exp: entry.exp,
        });
        continue;
      }

      const resolved = fromSourceId(entry.sourceType, entry.sourceId);
      if (!resolved) continue;
      const title = titlesByModule[resolved.module]?.get(resolved.slug);
      if (title === undefined) continue;

      items.push({
        date: toUtcDateKey(entry.updatedAt),
        module: resolved.module,
        slug: resolved.slug,
        title,
        route: resolved.route,
        exp: entry.exp,
      });
    }
    return items;
  }
}
