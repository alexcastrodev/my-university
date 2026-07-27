import { Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { DatabaseConceptsService } from './database-concepts.service';

@Controller('database-concepts')
export class DatabaseConceptsController {
  constructor(
    private service: DatabaseConceptsService,
    private xp: XpService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
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
      (await this.xp.hasEntry(userId, 'concept-read', `db:${slug}`));
    return { ...concept, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(userId, `db:${slug}`);
    return { read: true };
  }
}
