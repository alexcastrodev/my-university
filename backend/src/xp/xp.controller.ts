import { Controller, Get } from '@nestjs/common';
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

  @Get('leaderboard')
  getLeaderboard(@CurrentUserId() userId: number) {
    return this.service.getLeaderboard();
  }
}
