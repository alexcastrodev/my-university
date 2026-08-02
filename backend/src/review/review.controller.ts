import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import type { ReviewSourceType } from './review-schedule.entity';
import { ReviewService } from './review.service';
import type { ReviewRating } from './sm2';

@Controller('review')
export class ReviewController {
  constructor(private review: ReviewService) {}

  @Post('schedule')
  async schedule(
    @CurrentUserId() userId: number,
    @Body('module') module: string,
    @Body('slug') slug: string,
  ) {
    await this.review.scheduleFirstReview(userId, module, slug);
    return { scheduled: true };
  }

  @Get('due')
  getDue(@CurrentUserId() userId: number) {
    return this.review.getDueQueue(userId);
  }

  @Post('answer')
  answer(
    @CurrentUserId() userId: number,
    @Body('sourceType') sourceType: ReviewSourceType,
    @Body('sourceId') sourceId: string,
    @Body('rating') rating: ReviewRating,
  ) {
    return this.review.recordAnswer(userId, sourceType, sourceId, rating);
  }
}
