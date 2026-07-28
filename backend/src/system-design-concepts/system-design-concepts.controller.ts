import { Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { SystemDesignConceptsService } from './system-design-concepts.service';

@Controller('system-design-concepts')
export class SystemDesignConceptsController {
  constructor(
    private service: SystemDesignConceptsService,
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
      (await this.xp.hasEntry(userId, 'concept-read', `sysdesign:${slug}`));
    return { ...concept, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const concept = this.service.findBySlug(slug);
    if (!concept) throw new NotFoundException();
    await this.xp.grantConceptReadXp(userId, `sysdesign:${slug}`);
    return { read: true };
  }
}
