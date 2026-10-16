import { Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { XpService } from './xp.service';

/** A query value as an integer within bounds; anything missing or not a number falls back to `fallback`. */
function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

@Controller('xp')
export class XpController {
  constructor(private service: XpService) {}

  @Get()
  getXp(@CurrentUserId() userId: number) {
    return this.service.getUserXp(userId);
  }

  @Get('summary')
  getSummary(@CurrentUserId() userId: number) {
    return this.service.getSummary(userId);
  }

  @Get('history')
  getHistory(@CurrentUserId() userId: number) {
    return this.service.getHistory(userId);
  }

  /** Paged activity for the "Load more" list: `{ items, hasMore }`. `limit` is clamped to 1 to 50 (default 20). */
  @Get('history/paged')
  getHistoryPage(
    @CurrentUserId() userId: number,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.getHistoryPage(userId, clampInt(limit, 20, 1, 50), clampInt(offset, 0, 0, 100_000));
  }

  @Get('streak')
  getStreak(@CurrentUserId() userId: number) {
    return this.service.getStreak(userId);
  }

  @Get('daily-goal')
  getDailyGoal(@CurrentUserId() userId: number) {
    return this.service.getDailyGoalStatus(userId);
  }

  @Get('areas')
  getAreaBreakdown(@CurrentUserId() userId: number) {
    return this.service.getAreaBreakdown(userId);
  }

  /** Read-only: awards and current progress. Reading never grants anything. */
  @Get('achievements')
  getAchievements(@CurrentUserId() userId: number) {
    return this.service.getAchievements(userId);
  }

  /** Read-only: every active track with its badges and trophy, and the user's progress on each. */
  @Get('achievements/catalog')
  getAchievementCatalog(@CurrentUserId() userId: number) {
    return this.service.getAchievementCatalog(userId);
  }

  /** Read-only: what one track asks for, unit by unit. 404 for an unknown, retired or invalid track. */
  @Get('achievements/catalog/:trackId')
  async getTrackRequirements(@CurrentUserId() userId: number, @Param('trackId') trackId: string) {
    const view = await this.service.getTrackRequirements(userId, trackId);
    if (!view) throw new NotFoundException();
    return view;
  }

  /** Records awards earned but not yet recorded; returns only the ones this call created. */
  @Post('achievements/sync')
  async syncAchievements(@CurrentUserId() userId: number) {
    return { newAwards: await this.service.syncAchievements(userId) };
  }

  /** Public — anyone can see the leaderboard, logged in or not. Users who made their profile private are not listed. */
  @Get('leaderboard')
  getLeaderboard(@Res({ passthrough: true }) reply: FastifyReply) {
    // Never stored anywhere: going private must take effect on the very next request.
    reply.header('Cache-Control', 'no-store');
    return this.service.getLeaderboard();
  }
}

/** Public learner profiles, reachable by link and never by login or user id. */
@Controller('profile')
export class ProfileController {
  constructor(private service: XpService) {}

  /** `:key` is the `publicProfileId` or the user's vanity slug; both reach the same profile. */
  @Get(':key')
  async getProfile(
    @Param('key') key: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    const profile = await this.service.getPublicProfile(key);
    if (!profile) throw new NotFoundException();
    return profile;
  }
}
