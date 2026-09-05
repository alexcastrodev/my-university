import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import { XpService } from '../xp/xp.service';
import { CurriculumService } from './curriculum.service';

@Controller('curriculum')
export class CurriculumController {
  constructor(
    private readonly service: CurriculumService,
    private readonly xp: XpService,
  ) {}

  private sourceId(mod: string, discipline: string, slug: string): string {
    return `cc:${mod}:${discipline}:${slug}`;
  }

  @Get(':module/:discipline')
  async findAll(
    @Param('module') mod: string,
    @Param('discipline') discipline: string,
    @OptionalUserId() userId: number | null,
    @Query('lang') lang?: string,
  ) {
    const concepts = this.service.findAll(
      mod,
      discipline,
      normalizeLanguage(lang),
    );
    const readSlugs =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'concept-read');
    return concepts.map((concept) => ({
      ...concept,
      read: readSlugs.has(this.sourceId(mod, discipline, concept.slug)),
    }));
  }

  @Get(':module/:discipline/:slug')
  async findOne(
    @Param('module') mod: string,
    @Param('discipline') discipline: string,
    @Param('slug') slug: string,
    @OptionalUserId() userId: number | null,
    @Query('lang') lang?: string,
  ) {
    const concept = this.service.findBySlug(
      mod,
      discipline,
      slug,
      normalizeLanguage(lang),
    );
    if (!concept) throw new NotFoundException();
    const read =
      userId !== null &&
      (await this.xp.hasEntry(
        userId,
        'concept-read',
        this.sourceId(mod, discipline, slug),
      ));
    return { ...concept, read };
  }

  @Put(':module/:discipline/:slug/read')
  async markRead(
    @Param('module') mod: string,
    @Param('discipline') discipline: string,
    @Param('slug') slug: string,
    @CurrentUserId() userId: number,
  ) {
    const concept = this.service.findBySlug(mod, discipline, slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(
      userId,
      this.sourceId(mod, discipline, slug),
    );
    return { read: true };
  }
}
