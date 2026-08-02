import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { JavaConceptsService } from '../java-concepts/java-concepts.service';
import { SpringConceptsService } from '../spring-concepts/spring-concepts.service';
import { DatabaseConceptsService } from '../database-concepts/database-concepts.service';
import { SystemDesignConceptsService } from '../system-design-concepts/system-design-concepts.service';
import { JavaMinuteService } from '../java-minute/java-minute.service';
import { ReviewSchedule, ReviewSourceType } from './review-schedule.entity';
import { fromSourceId, toSourceId } from './review.constants';
import { nextSchedule, ReviewRating } from './sm2';

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

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(ReviewSchedule) private repo: Repository<ReviewSchedule>,
    private javaConcepts: JavaConceptsService,
    private springConcepts: SpringConceptsService,
    private databaseConcepts: DatabaseConceptsService,
    private systemDesignConcepts: SystemDesignConceptsService,
    private javaMinute: JavaMinuteService,
  ) {}

  /** Schedules the first review, one day after the item is marked read. No-op if already scheduled. */
  async scheduleFirstReview(userId: number, module: string, slug: string): Promise<void> {
    const resolved = toSourceId(module, slug);
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

  async getDueQueue(userId: number): Promise<ReviewQueueItem[]> {
    const rows = await this.repo.find({
      where: { userId, dueAt: LessThanOrEqual(new Date()) },
      order: { dueAt: 'ASC' },
    });

    const titlesByModule = {
      'java-concepts': new Map(this.javaConcepts.findAll().map((c) => [c.slug, c.title])),
      'spring-concepts': new Map(this.springConcepts.findAll().map((c) => [c.slug, c.title])),
      'database-concepts': new Map(this.databaseConcepts.findAll().map((c) => [c.slug, c.title])),
      'system-design-concepts': new Map(this.systemDesignConcepts.findAll().map((c) => [c.slug, c.title])),
      'java-minute': new Map(this.javaMinute.findAll().map((e) => [e.slug, e.question])),
    } as Record<string, Map<string, string>>;

    const items: ReviewQueueItem[] = [];
    for (const row of rows) {
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
