import { Controller, Get, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import { XpService } from '../xp/xp.service';
import { SpringConceptsService } from './spring-concepts.service';

@Controller('spring-concepts')
export class SpringConceptsController {
  constructor(
    private service: SpringConceptsService,
    private xp: XpService,
  ) {}

  @Get()
  async findAll(@OptionalUserId() userId: number | null, @Query('lang') lang?: string) {
    const concepts = this.service.findAll(normalizeLanguage(lang));
    const readSlugs =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'concept-read');
    return concepts.map((concept) => ({
      ...concept,
      read: readSlugs.has(`spring:${concept.slug}`),
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
      (await this.xp.hasEntry(userId, 'concept-read', `spring:${slug}`));
    return { ...concept, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(userId, `spring:${slug}`);
    return { read: true };
  }
}
