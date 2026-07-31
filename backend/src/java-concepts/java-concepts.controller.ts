import { Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { JavaConceptsService } from './java-concepts.service';

@Controller('java-concepts')
export class JavaConceptsController {
  constructor(
    private service: JavaConceptsService,
    private xp: XpService,
  ) {}

  @Get()
  async findAll(@OptionalUserId() userId: number | null) {
    const concepts = this.service.findAll();
    const readSlugs =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'concept-read');
    return concepts.map((concept) => ({
      ...concept,
      read: readSlugs.has(concept.slug),
    }));
  }

  @Get(':slug')
  async findOne(
    @Param('slug') slug: string,
    @OptionalUserId() userId: number | null,
  ) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    const read =
      userId !== null && (await this.xp.hasEntry(userId, 'concept-read', slug));
    return { ...concept, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(userId, slug);
    return { read: true };
  }
}
