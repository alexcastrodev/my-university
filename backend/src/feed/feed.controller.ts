import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUserId, OptionalUserId } from '../auth/session';
import { normalizeLanguage } from '../shared/language';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private feed: FeedService) {}

  /** Public: a guest gets the same cards, just without read state or a "Got it" count. */
  @Get()
  getPage(
    @OptionalUserId() userId: number | null,
    @Query('area') area?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
  ) {
    return this.feed.getPage(userId, {
      area,
      offset: offset ? Number(offset) || 0 : 0,
      limit: limit ? Number(limit) || undefined : undefined,
      lang: normalizeLanguage(lang),
    });
  }

  @Post('got-it')
  gotIt(
    @CurrentUserId() userId: number,
    @Body('module') module: string,
    @Body('slug') slug: string,
    @Body('discipline') discipline?: string,
  ) {
    return this.feed.gotIt(userId, module, slug, discipline);
  }
}
