import { Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { JavaMinuteService } from './java-minute.service';

@Controller('java-minute')
export class JavaMinuteController {
  constructor(
    private service: JavaMinuteService,
    private xp: XpService,
  ) {}

  @Get()
  async findAll(@OptionalUserId() userId: number | null) {
    const episodes = this.service.findAll();
    const readSlugs =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'episode-watched');
    return episodes.map((episode) => ({
      ...episode,
      read: readSlugs.has(episode.slug),
    }));
  }

  @Get(':slug')
  async findOne(
    @Param('slug') slug: string,
    @OptionalUserId() userId: number | null,
  ) {
    const episode = this.service.findBySlug(slug);
    if (!episode) throw new NotFoundException();
    const read =
      userId !== null &&
      (await this.xp.hasEntry(userId, 'episode-watched', slug));
    return { ...episode, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const episode = this.service.findBySlug(slug);
    if (!episode) throw new NotFoundException();
    await this.xp.grantEpisodeWatchedXp(userId, slug);
    return { read: true };
  }
}
