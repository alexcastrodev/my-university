import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { ConceptSection } from '../shared/concept-content';
import { AlgorithmsConceptsService } from '../algorithms-concepts/algorithms-concepts.service';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { JvmConceptsService } from '../jvm-concepts/jvm-concepts.service';
import { QuarkusConceptsService } from '../quarkus-concepts/quarkus-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { TestingConceptsService } from '../testing-concepts/testing-concepts.service';
import { RubyConceptsService } from '../ruby-concepts/ruby-concepts.service';
import { RubyOnRailsConceptsService } from '../rubyonrails-concepts/rubyonrails-concepts.service';
import { ReviewSchedule, ReviewSourceType } from './review-schedule.entity';
import { curriculumSourceId, fromSourceId, parseCurriculumSourceId, ResolvedCurriculum, ResolvedSource, toSourceId } from './review.constants';
import { nextSchedule, ReviewRating } from './sm2';
import { XpService } from '../xp/xp.service';
import { CurriculumService } from '../curriculum/curriculum.service';
import { toUtcDateKey } from '../xp/streak';

const INITIAL_INTERVAL_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReviewQueueItem {
  sourceType: ReviewSourceType;
  sourceId: string;
  module: string;
  slug: string;
  title: string;
  route: string[];
  dueAt: Date;
}

export interface RecentActivityItem {
  date: string;
  module: string;
  slug: string;
  title: string;
  route: string[];
  exp: number;
}

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(ReviewSchedule) private repo: Repository<ReviewSchedule>,
    private xp: XpService,
    private javaConcepts: JavaConceptsService,
    private jvmConcepts: JvmConceptsService,
    private springConcepts: SpringConceptsService,
    private databaseConcepts: DatabaseConceptsService,
    private systemDesignConcepts: SystemDesignConceptsService,
    private javaMinute: JavaMinuteService,
    private testingConcepts: TestingConceptsService,
    private algorithmsConcepts: AlgorithmsConceptsService,
    private rubyConcepts: RubyConceptsService,
    private rubyOnRailsConcepts: RubyOnRailsConceptsService,
    private quarkusConcepts: QuarkusConceptsService,
    private curriculum: CurriculumService,
  ) {}

  /** Module -> slug -> human title, for every Complementary Studies area — the single lookup
   *  `getDueQueue` and `getRecentActivity` both resolve a sourceId's display title through. */
  private buildTitlesByModule(): Record<string, Map<string, string>> {
    return {
      'java-concepts': new Map(this.javaConcepts.findAll().map((c) => [c.slug, c.title])),
      'jvm-concepts': new Map(this.jvmConcepts.findAll().map((c) => [c.slug, c.title])),
      'spring-concepts': new Map(this.springConcepts.findAll().map((c) => [c.slug, c.title])),
      'database-concepts': new Map(this.databaseConcepts.findAll().map((c) => [c.slug, c.title])),
      'system-design-concepts': new Map(this.systemDesignConcepts.findAll().map((c) => [c.slug, c.title])),
      'java-minute': new Map(this.javaMinute.findAll().map((e) => [e.slug, e.question])),
      'testing-concepts': new Map(this.testingConcepts.findAll().map((c) => [c.slug, c.title])),
      'algorithms-concepts': new Map(this.algorithmsConcepts.findAll().map((c) => [c.slug, c.title])),
      'ruby-concepts': new Map(this.rubyConcepts.findAll().map((c) => [c.slug, c.title])),
      'rubyonrails-concepts': new Map(this.rubyOnRailsConcepts.findAll().map((c) => [c.slug, c.title])),
      'quarkus-concepts': new Map(this.quarkusConcepts.findAll().map((c) => [c.slug, c.title])),
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
  ): { title: string; sections: ConceptSection[] } | undefined {
    switch (module) {
      case 'java-concepts': {
        const d = this.javaConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'jvm-concepts': {
        const d = this.jvmConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'spring-concepts': {
        const d = this.springConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'database-concepts': {
        const d = this.databaseConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'system-design-concepts': {
        const d = this.systemDesignConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'java-minute': {
        const d = this.javaMinute.findBySlug(slug);
        return d ? { title: d.question, sections: d.sections } : undefined;
      }
      case 'testing-concepts': {
        const d = this.testingConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'algorithms-concepts': {
        const d = this.algorithmsConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'ruby-concepts': {
        const d = this.rubyConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'rubyonrails-concepts': {
        const d = this.rubyOnRailsConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      case 'quarkus-concepts': {
        const d = this.quarkusConcepts.findBySlug(slug);
        return d ? { title: d.title, sections: d.sections } : undefined;
      }
      default:
        return undefined;
    }
  }

  /**
   * Full content behind a sourceId — the same resolution `getDueQueue`/`getRecentActivity`
   * do for a display title, but returning `sections` too. This is the one seam
   * `DailyService` (grupo F session builder) reads real Read/Notice card content through,
   * instead of `DailyModule` re-importing all eleven concept modules itself.
   */
  resolveConceptDetail(
    sourceType: ReviewSourceType,
    sourceId: string,
  ): { title: string; sections: ConceptSection[]; route: string[] } | null {
    const cc = parseCurriculumSourceId(sourceId);
    if (cc) {
      const detail = this.curriculum.findBySlug(cc.module, cc.discipline, cc.slug);
      if (!detail) return null;
      return { title: detail.title, sections: detail.sections, route: cc.route };
    }

    const resolved = fromSourceId(sourceType, sourceId);
    if (!resolved) return null;
    const detail = this.conceptDetailByModule(resolved.module, resolved.slug);
    if (!detail) return null;
    return { title: detail.title, sections: detail.sections, route: resolved.route };
  }

  /** Schedules the first review, one day after the item is marked read. No-op if already scheduled.
   *  A Computer Science curriculum concept passes its `discipline` (three-part identity); the flat
   *  Complementary tracks omit it and resolve through REVIEW_MODULES. */
  async scheduleFirstReview(userId: number, module: string, slug: string, discipline?: string): Promise<void> {
    let resolved: ResolvedSource | null;
    if (discipline) {
      if (!this.curriculum.findBySlug(module, discipline, slug)) throw new NotFoundException();
      resolved = { sourceType: 'concept-read' as ReviewSourceType, sourceId: curriculumSourceId(module, discipline, slug) };
    } else {
      resolved = toSourceId(module, slug);
    }
    if (!resolved) throw new NotFoundException();

    const dueAt = new Date(Date.now() + INITIAL_INTERVAL_DAYS * DAY_MS);
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(ReviewSchedule)
      .values({
        userId,
        sourceType: resolved.sourceType,
        sourceId: resolved.sourceId,
        dueAt,
        intervalDays: INITIAL_INTERVAL_DAYS,
      })
      .orIgnore()
      .execute();
  }

  /** Human title for a Computer Science curriculum concept, or undefined if its discipline/content
   *  was removed since the review was scheduled (mirrors the "content since removed" skip below). */
  private curriculumTitle(cc: ResolvedCurriculum): string | undefined {
    try {
      return this.curriculum.findBySlug(cc.module, cc.discipline, cc.slug)?.title;
    } catch {
      return undefined;
    }
  }

  async getDueQueue(userId: number): Promise<ReviewQueueItem[]> {
    const rows = await this.repo.find({
      where: { userId, dueAt: LessThanOrEqual(new Date()) },
      order: { dueAt: 'ASC' },
    });

    const titlesByModule = this.buildTitlesByModule();

    const items: ReviewQueueItem[] = [];
    for (const row of rows) {
      const cc = parseCurriculumSourceId(row.sourceId);
      if (cc) {
        const title = this.curriculumTitle(cc);
        if (title === undefined) continue; // discipline/content since removed
        items.push({
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          module: cc.module,
          slug: cc.slug,
          title,
          route: cc.route,
          dueAt: row.dueAt,
        });
        continue;
      }

      const resolved = fromSourceId(row.sourceType, row.sourceId);
      if (!resolved) continue;
      const title = titlesByModule[resolved.module]?.get(resolved.slug);
      if (title === undefined) continue; // content since removed from the module's seed data

      items.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        module: resolved.module,
        slug: resolved.slug,
        title,
        route: resolved.route,
        dueAt: row.dueAt,
      });
    }
    return items;
  }

  /**
   * "What you learned this week" — real `user_xp_entry` rows from the last `days` days,
   * resolved to a human title through the same lookup `getDueQueue` uses. An entry whose
   * module/slug doesn't resolve (a course lesson, a skill check, content since removed) is
   * skipped rather than shown with a placeholder title.
   */
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

  /**
   * "Got it" mark counts: `active` marks aren't due yet (still holding); `expired` marks are
   * due now — the concept comes back as a review question, matching the "a mark expires after
   * 6 months and comes back as a question" framing on the dashboard, expressed here in terms
   * of the real SM2 `dueAt` this app already tracks rather than a literal 6-month timer.
   */
  async getMarkCounts(userId: number): Promise<{ active: number; expired: number }> {
    const now = new Date();
    const [active, expired] = await Promise.all([
      this.repo.count({ where: { userId, dueAt: MoreThan(now) } }),
      this.repo.count({ where: { userId, dueAt: LessThanOrEqual(now) } }),
    ]);
    return { active, expired };
  }

  async recordAnswer(
    userId: number,
    sourceType: ReviewSourceType,
    sourceId: string,
    rating: ReviewRating,
  ): Promise<{ dueAt: Date; intervalDays: number }> {
    const schedule = await this.repo.findOne({ where: { userId, sourceType, sourceId } });
    if (!schedule) throw new NotFoundException();

    const next = nextSchedule(
      { easeFactor: schedule.easeFactor, intervalDays: schedule.intervalDays, repetitions: schedule.repetitions },
      rating,
    );
    schedule.easeFactor = next.easeFactor;
    schedule.intervalDays = next.intervalDays;
    schedule.repetitions = next.repetitions;
    schedule.dueAt = new Date(Date.now() + next.intervalDays * DAY_MS);
    schedule.lastReviewedAt = new Date();
    await this.repo.save(schedule);

    return { dueAt: schedule.dueAt, intervalDays: schedule.intervalDays };
  }
}
