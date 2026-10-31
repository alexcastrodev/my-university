import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { PAPER_CURATOR, PAPER_REVIEWER, Role } from '../auth/roles';
import { User } from '../auth/user.entity';
import {
  AnalysisAction,
  AnalysisStatus,
  PaperAnalysis,
  PaperAnalysisEvent,
} from './paper-analysis.entity';
import {
  inReadingOrder,
  missingSections,
  Sections,
} from './paper-analysis.sections';
import { PapersCatalogService } from './papers-catalog.service';

/** Someone the page credits. The profile link exists only when that person made the profile public. */
export interface Person {
  name: string;
  profilePath: string | null;
}

/** What readers see: the published revision and who stands behind it. Nothing of a draft ever goes in here. */
export interface PublicAnalysis {
  revision: number;
  publishedAt: Date;
  author: Person | null;
  publishedBy: Person | null;
  sections: Sections;
}

export interface RevisionView {
  id: number;
  revision: number;
  status: AnalysisStatus;
  sections: Sections;
  author: Person | null;
  publishedBy: Person | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventView {
  id: number;
  revision: number;
  action: AnalysisAction;
  actor: Person | null;
  createdAt: Date;
}

const personOf = (user: User | undefined): Person | null =>
  user
    ? {
        name: user.displayNameOverride?.trim() || user.displayName,
        profilePath: user.profilePublic
          ? `/u/${user.profileSlug ?? user.publicProfileId}`
          : null,
      }
    : null;

/**
 * Curators write drafts, reviewers publish and withdraw. Holding both roles lets one person do the whole
 * cycle; the page then credits that person as author and as reviewer, so it is visible rather than hidden.
 * Every change leaves an event, and the people are named from the user row, not from anything the client sends.
 */
@Injectable()
export class PaperAnalysisService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PapersCatalogService)
    private readonly catalog: PapersCatalogService,
  ) {}

  async getPublic(paperId: number): Promise<{ analysis: PublicAnalysis | null }> {
    await this.catalog.titleOf(paperId);
    const row = await this.dataSource
      .getRepository(PaperAnalysis)
      .findOne({ where: { paperId, status: 'published' } });
    if (!row?.publishedAt) return { analysis: null };
    const people = await this.people([row.authorId, row.publishedById]);
    return {
      analysis: {
        revision: row.revision,
        publishedAt: row.publishedAt,
        author: personOf(people.get(row.authorId ?? 0)),
        publishedBy: personOf(people.get(row.publishedById ?? 0)),
        sections: inReadingOrder(row.sections),
      },
    };
  }

  /** Every revision with its sections, and the audit trail. Curators and reviewers only: it includes drafts. */
  async history(paperId: number, userId: number) {
    await this.requireRole(userId, PAPER_CURATOR, PAPER_REVIEWER);
    await this.catalog.titleOf(paperId);
    const revisions = await this.dataSource
      .getRepository(PaperAnalysis)
      .find({ where: { paperId }, order: { revision: 'DESC' } });
    const events = revisions.length
      ? await this.dataSource.getRepository(PaperAnalysisEvent).find({
          where: { analysisId: In(revisions.map((r) => r.id)) },
          order: { id: 'ASC' },
        })
      : [];
    const people = await this.people([
      ...revisions.flatMap((r) => [r.authorId, r.publishedById]),
      ...events.map((e) => e.actorId),
    ]);
    const revisionOf = new Map(revisions.map((r) => [r.id, r.revision]));
    return {
      revisions: revisions.map(
        (r): RevisionView => this.view(r, people),
      ),
      events: events.map(
        (e): EventView => ({
          id: e.id,
          revision: revisionOf.get(e.analysisId) ?? 0,
          action: e.action,
          actor: personOf(people.get(e.actorId ?? 0)),
          createdAt: e.createdAt,
        }),
      ),
    };
  }

  /** Creates the working copy of the analysis, or replaces its sections when one already exists. */
  async saveDraft(paperId: number, userId: number, sections: Sections) {
    await this.requireRole(userId, PAPER_CURATOR);
    await this.catalog.titleOf(paperId);
    return this.dataSource.transaction(async (manager) => {
      await this.lockPaper(manager, paperId);
      const repo = manager.getRepository(PaperAnalysis);
      let draft = await repo.findOne({ where: { paperId, status: 'draft' } });
      let action: AnalysisAction = 'draft_edited';
      if (draft) {
        draft.sections = sections;
      } else {
        const last = (await repo.maximum('revision', { paperId })) ?? 0;
        draft = repo.create({
          paperId,
          revision: last + 1,
          status: 'draft',
          sections,
          authorId: userId,
        });
        action = 'draft_created';
      }
      draft = await repo.save(draft);
      await this.record(manager, draft, action, userId);
      return this.viewOf(manager, draft);
    });
  }

  /** The draft becomes what readers see; the analysis it replaces is kept as `superseded`. */
  async publish(paperId: number, userId: number) {
    await this.requireRole(userId, PAPER_REVIEWER);
    await this.catalog.titleOf(paperId);
    return this.dataSource.transaction(async (manager) => {
      await this.lockPaper(manager, paperId);
      const repo = manager.getRepository(PaperAnalysis);
      const draft = await repo.findOne({ where: { paperId, status: 'draft' } });
      if (!draft) throw new ConflictException('There is no draft to publish');
      const missing = missingSections(draft.sections);
      if (missing.length) {
        throw new UnprocessableEntityException({
          message: `Every section needs a decision before publishing: ${missing.join(', ')}`,
          missing,
        });
      }
      await repo.update({ paperId, status: 'published' }, { status: 'superseded' });
      draft.status = 'published';
      draft.publishedById = userId;
      draft.publishedAt = new Date();
      await repo.save(draft);
      await this.record(manager, draft, 'published', userId);
      return this.viewOf(manager, draft);
    });
  }

  /** Takes the published analysis down. Publishing again needs a new draft, so the take-down stays on record. */
  async withdraw(paperId: number, userId: number) {
    await this.requireRole(userId, PAPER_REVIEWER);
    await this.catalog.titleOf(paperId);
    return this.dataSource.transaction(async (manager) => {
      await this.lockPaper(manager, paperId);
      const repo = manager.getRepository(PaperAnalysis);
      const published = await repo.findOne({
        where: { paperId, status: 'published' },
      });
      if (!published) throw new ConflictException('There is no published analysis');
      published.status = 'withdrawn';
      await repo.save(published);
      await this.record(manager, published, 'withdrawn', userId);
      return this.viewOf(manager, published);
    });
  }

  private async requireRole(userId: number, ...roles: Role[]): Promise<void> {
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId }, select: { id: true, roles: true } });
    if (!user || !roles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException();
    }
  }

  /** Serializes writers of one paper: two curators saving at once cannot both create a draft. */
  private async lockPaper(manager: EntityManager, paperId: number) {
    const rows: unknown[] = await manager.query(
      'SELECT id FROM paper WHERE id = $1 FOR UPDATE',
      [paperId],
    );
    if (!rows.length) throw new NotFoundException();
  }

  private record(
    manager: EntityManager,
    analysis: PaperAnalysis,
    action: AnalysisAction,
    actorId: number,
  ) {
    return manager
      .getRepository(PaperAnalysisEvent)
      .save({ analysisId: analysis.id, action, actorId });
  }

  private async viewOf(manager: EntityManager, row: PaperAnalysis) {
    const people = await this.people(
      [row.authorId, row.publishedById],
      manager,
    );
    return this.view(row, people);
  }

  private view(row: PaperAnalysis, people: Map<number, User>): RevisionView {
    return {
      id: row.id,
      revision: row.revision,
      status: row.status,
      sections: inReadingOrder(row.sections),
      author: personOf(people.get(row.authorId ?? 0)),
      publishedBy: personOf(people.get(row.publishedById ?? 0)),
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async people(
    ids: (number | null)[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<number, User>> {
    const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
    if (!wanted.length) return new Map();
    const users = await manager.getRepository(User).find({
      where: { id: In(wanted) },
      select: {
        id: true,
        displayName: true,
        displayNameOverride: true,
        profilePublic: true,
        profileSlug: true,
        publicProfileId: true,
      },
    });
    return new Map(users.map((u) => [u.id, u]));
  }
}
