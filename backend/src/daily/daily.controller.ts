import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import type { ReviewSourceType } from '../review/review-schedule.entity';
import type { ReviewRating } from '../review/sm2';
import { DailyService } from './daily.service';
import type { DailyCardType } from './daily.service';

@Controller('daily')
export class DailyController {
  constructor(private daily: DailyService) {}

  @Get('session')
  getSession(@CurrentUserId() userId: number) {
    return this.daily.buildSession(userId);
  }

  @Post('complete')
  complete(
    @CurrentUserId() userId: number,
    @Body('type') type: DailyCardType,
    @Body('sourceId') sourceId: string,
    @Body('sourceType') sourceType?: ReviewSourceType,
    @Body('rating') rating?: ReviewRating,
    @Body('text') text?: string,
  ) {
    return this.daily.completeCard(userId, type, sourceId, { sourceType, rating, text });
  }
}
