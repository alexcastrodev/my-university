import { Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { QuarkusConceptsService } from './quarkus-concepts.service';

@Controller('quarkus-concepts')
export class QuarkusConceptsController {
  constructor(
    private service: QuarkusConceptsService,
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
      read: readSlugs.has(`quarkus:${concept.slug}`),
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
      userId !== null &&
      (await this.xp.hasEntry(userId, 'concept-read', `quarkus:${slug}`));
    return { ...concept, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(userId, `quarkus:${slug}`);
    return { read: true };
  }
}
