import { Get, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { Language, normalizeLanguage } from './language';

/** What every `*-concepts.service.ts` exposes, whether or not it currently supports `lang` — a service that ignores the extra argument still satisfies this. */
export interface ConceptsService<
  TSummary extends { slug: string },
  TDetail extends { slug: string },
> {
  findAll(lang?: Language): TSummary[];
  findBySlug(slug: string, lang?: Language): TDetail | null;
}

/**
 * The `findAll` / `findOne` / `PUT :slug/read` trio every concept-track controller repeats
 * verbatim, differing only in which service backs it and the XP source-id prefix used to
 * namespace that track's read-tracking entries (e.g. `jvm:`, `sysdesign:` — some tracks, like
 * java-concepts, historically use no prefix at all, which is why it's a plain string here rather
 * than something required). A concrete controller just needs `@Controller('slug')` and a
 * constructor that injects its service + XpService and calls `super(...)` — see
 * java-concepts.controller.ts for the shape. NestJS resolves `@Get`/`@Put` route metadata by
 * walking the prototype chain, so routes declared here are picked up on the subclass with no
 * method overrides needed.
 */
export abstract class ConceptsControllerBase<
  TSummary extends { slug: string },
  TDetail extends { slug: string },
> {
  protected constructor(
    private readonly service: ConceptsService<TSummary, TDetail>,
    private readonly xp: XpService,
    private readonly sourceIdPrefix: string,
  ) {}

  private sourceId(slug: string): string {
    return this.sourceIdPrefix ? `${this.sourceIdPrefix}:${slug}` : slug;
  }

  @Get()
  async findAll(
    @OptionalUserId() userId: number | null,
    @Query('lang') lang?: string,
  ) {
    const concepts = this.service.findAll(normalizeLanguage(lang));
    const readSlugs =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'concept-read');
    return concepts.map((concept) => ({
      ...concept,
      read: readSlugs.has(this.sourceId(concept.slug)),
    }));
  }

  @Get(':slug')
  async findOne(
    @Param('slug') slug: string,
    @OptionalUserId() userId: number | null,
    @Query('lang') lang?: string,
  ) {
    const concept = this.service.findBySlug(slug, normalizeLanguage(lang));
    if (!concept) throw new NotFoundException();
    const read =
      userId !== null &&
      (await this.xp.hasEntry(userId, 'concept-read', this.sourceId(slug)));
    return { ...concept, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(userId, this.sourceId(slug));
    return { read: true };
  }
}
