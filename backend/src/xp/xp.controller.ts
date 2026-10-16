import { Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentUserId } from '../auth/session';
import { XpService } from './xp.service';

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

  @Get(':publicProfileId')
  async getProfile(
    @Param('publicProfileId') publicProfileId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    const profile = await this.service.getPublicProfile(publicProfileId);
    if (!profile) throw new NotFoundException();
    return profile;
  }
}
