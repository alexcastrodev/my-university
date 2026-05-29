import { Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private service: AuthService) {}

  @Post('login')
  login(@Body('displayName') displayName: string) {
    return this.service.login(displayName ?? '');
  }

  @Post('signup')
  signup(@Body('displayName') displayName: string) {
    return this.service.signup(displayName ?? '');
  }

  @Get('me')
  me(@Headers('x-user-id') userId: string | string[] | undefined) {
    const id = Number(Array.isArray(userId) ? userId[0] : userId);
    if (!Number.isInteger(id) || id <= 0) throw new UnauthorizedException();
    return this.service.findById(id);
  }
}
