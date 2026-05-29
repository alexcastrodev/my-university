import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { clearSession, CurrentUserId, setSession } from './session';

@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}

  @Post('login')
  async login(
    @Body('displayName') displayName: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.service.login(displayName ?? '');
    setSession(reply, user.id);
    return user;
  }

  @Post('signup')
  async signup(
    @Body('displayName') displayName: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.service.signup(displayName ?? '');
    setSession(reply, user.id);
    return user;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    clearSession(reply);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUserId() userId: number) {
    return this.service.findById(userId);
  }
}
