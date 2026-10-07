import { Get, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { XpService } from '../xp/xp.service';
import { normalizeLanguage } from './language';
import { MinuteEpisodesServiceBase } from './minute-episodes.service';

/**
 * The `findAll` / `findOne` / `PUT :slug/read` trio of a "minute" track, the
 * `episode-watched` counterpart of `ConceptsControllerBase`. Java Minute historically
 * uses no XP source-id prefix; later tracks namespace theirs (e.g. `csharp:`) so their
 * slugs never collide with Java Minute's in `user_xp_entry`.
 */
export abstract class MinuteControllerBase {
  protected constructor(
    private readonly service: MinuteEpisodesServiceBase,
    private readonly xp: XpService,
    private readonly sourceIdPrefix: string,
  ) {}

  private sourceId(slug: string): string {
    return this.sourceIdPrefix ? `${this.sourceIdPrefix}:${slug}` : slug;
  }

  @Get()
  async findAll(@OptionalUserId() userId: number | null, @Query('lang') lang?: string) {
    const episodes = this.service.findAll(normalizeLanguage(lang));
    const readIds =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'episode-watched');
    return episodes.map((episode) => ({
      ...episode,
      read: readIds.has(this.sourceId(episode.slug)),
    }));
  }

  @Get(':slug')
  async findOne(
    @Param('slug') slug: string,
    @OptionalUserId() userId: number | null,
    @Query('lang') lang?: string,
  ) {
    const episode = this.service.findBySlug(slug, normalizeLanguage(lang));
    if (!episode) throw new NotFoundException();
    const read =
      userId !== null &&
      (await this.xp.hasEntry(userId, 'episode-watched', this.sourceId(slug)));
    return { ...episode, read };
  }

  @Put(':slug/read')
  async markRead(@Param('slug') slug: string, @CurrentUserId() userId: number) {
    const episode = this.service.findBySlug(slug);
    if (!episode) throw new NotFoundException();
    await this.xp.grantEpisodeWatchedXp(userId, this.sourceId(slug));
    return { read: true };
  }
}
