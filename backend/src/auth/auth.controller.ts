import { randomBytes } from 'crypto';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { GithubOauthService } from './github-oauth.service';
import {
  clearOauthState,
  clearSession,
  CurrentUserId,
  readOauthState,
  setOauthState,
  setSession,
} from './session';

@Controller('auth')
export class AuthController {
  constructor(
    private service: AuthService,
    private github: GithubOauthService,
  ) {}

  @Get('github')
  redirectToGithub(@Res() reply: FastifyReply): void {
    const state = randomBytes(16).toString('hex');
    setOauthState(reply, state);
    reply.redirect(this.github.buildAuthorizeUrl(state), 302);
  }

  @Get('github/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const frontendBase = process.env.FRONTEND_URL ?? '';
    const expectedState = readOauthState(req);
    clearOauthState(reply);

    if (!code || !state || !expectedState || state !== expectedState) {
      reply.redirect(`${frontendBase}/login?error=oauth_failed`, 302);
      return;
    }

    try {
      const token = await this.github.exchangeCode(code);
      const profile = await this.github.fetchProfile(token);
      const user = await this.service.upsertFromGithub(profile);
      setSession(reply, user.id);
      reply.redirect(frontendBase || '/', 302);
    } catch {
      reply.redirect(`${frontendBase}/login?error=oauth_failed`, 302);
    }
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

  /** Sets or clears (empty/whitespace body) the caller's display name override, and/or their preferred content language. */
  @Put('settings')
  async updateSettings(
    @CurrentUserId() userId: number,
    @Body('displayName') displayName: string | null | undefined,
    @Body('language') language: string | undefined,
  ) {
    if (displayName !== undefined) {
      await this.service.updateDisplayNameOverride(userId, displayName);
    }
    if (language !== undefined) {
      await this.service.updatePreferredLanguage(userId, language);
    }
    return this.service.findById(userId);
  }

  /** Lets the login page know whether the dev-login shortcut is available. */
  @Get('dev-mode')
  devMode() {
    return { enabled: process.env.NODE_ENV !== 'production' };
  }

  /** Dev-only: logs in as a stable local account without going through GitHub. */
  @Post('dev-login')
  async devLogin(@Res({ passthrough: true }) reply: FastifyReply) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const user = await this.service.upsertDevUser();
    setSession(reply, user.id);
    return user;
  }

  /** Test-only: bypasses the GitHub OAuth flow so specs can log in as an arbitrary user. */
  @Post('_test/login')
  async testLogin(
    @Body('displayName') displayName: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const user = await this.service.createTestUser(
      displayName || `test-${Date.now()}`,
    );
    setSession(reply, user.id);
    return { id: user.id };
  }
}
