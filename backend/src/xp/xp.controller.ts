import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { XpService } from './xp.service';

@Controller('xp')
export class XpController {
  constructor(private service: XpService) {}

  @Get()
  getXp(@Headers('x-user-id') userId: string | string[] | undefined) {
    return this.service.getUserXp(this.readUserId(userId));
  }

  private readUserId(userId: string | string[] | undefined): number {
    const id = Number(Array.isArray(userId) ? userId[0] : userId);
    if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedException();
    return id;
  }
}
