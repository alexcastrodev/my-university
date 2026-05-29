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
}
