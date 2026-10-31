import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { assertDevAuth, devAuthEnabled } from './dev-auth';
import { GithubOauthService } from './github-oauth.service';
import {
  clearOauthState,
  clearSession,
  CurrentUserId,
  OptionalUserId,
  readOauthState,
  setOauthState,
  setSession,
} from './session';

const MAX_DISPLAY_NAME = 50;

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
      reply.redirect(`${frontendBase}/dashboard`, 302);
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

  /** Sets or clears (empty/whitespace body) the caller's display name override, and/or their preferred content language, and/or whether their profile is public. */
  @Put('settings')
  async updateSettings(
    @CurrentUserId() userId: number,
    @Body('displayName') displayName: string | null | undefined,
    @Body('language') language: string | undefined,
    @Body('profilePublic') profilePublic: unknown,
    @Body('notifyReplies') notifyReplies: unknown,
  ) {
    if (profilePublic !== undefined && typeof profilePublic !== 'boolean') {
      throw new BadRequestException('profilePublic must be a boolean');
    }
    if (notifyReplies !== undefined && typeof notifyReplies !== 'boolean') {
      throw new BadRequestException('notifyReplies must be a boolean');
    }
    if (displayName !== undefined && displayName !== null) {
      // Shown on the leaderboard, in discussions and on share images: bounded text only.
      if (typeof displayName !== 'string') throw new BadRequestException('displayName must be a string or null');
      if (displayName.trim().length > MAX_DISPLAY_NAME) {
        throw new BadRequestException(`displayName must have at most ${MAX_DISPLAY_NAME} characters`);
      }
    }
    if (displayName !== undefined) {
      await this.service.updateDisplayNameOverride(userId, displayName);
    }
    if (profilePublic !== undefined) {
      await this.service.updateProfilePublic(userId, profilePublic);
    }
    if (notifyReplies !== undefined) {
      await this.service.updateNotifyReplies(userId, notifyReplies);
    }
    if (language !== undefined) {
      await this.service.updatePreferredLanguage(userId, language);
    }
    return this.service.findById(userId);
  }

  /** Sets or clears (`null` or blank) the vanity slug of the caller's public link. 400 for a broken rule, 409 for a name already taken. */
  @Put('profile-slug')
  async updateProfileSlug(@CurrentUserId() userId: number, @Body('slug') slug: unknown) {
    if (slug !== null && typeof slug !== 'string') throw new BadRequestException('slug must be a string or null');
    return this.service.updateProfileSlug(userId, slug);
  }

  /** Lets the login page know whether the dev-login shortcut is available. */
  @Get('dev-mode')
  devMode() {
    return { enabled: devAuthEnabled() };
  }

  /** Dev-only: logs in as a stable local account without going through GitHub. */
  @Post('dev-login')
  async devLogin(@Res({ passthrough: true }) reply: FastifyReply) {
    assertDevAuth();
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
    assertDevAuth();
    const user = await this.service.createTestUser(
      displayName || `test-${Date.now()}`,
    );
    setSession(reply, user.id);
    return { id: user.id };
  }

  /** Test-only: wipes every user created via `_test/login`, so a spec run starts from a clean leaderboard. */
  @Post('_test/reset')
  async testReset() {
    assertDevAuth();
    await this.service.deleteTestUsers();
    return { ok: true };
  }
}
