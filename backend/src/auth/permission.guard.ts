import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Permission } from './permissions';
import { PermissionsService } from './permissions.service';
import { discardSession, readSession } from './session';

/** Metadata key of `@RequirePermission`; a spec reads it to check that every admin route declares one. */
export const PERMISSION_KEY = 'requiredPermission';

/**
 * Runs on every request (registered once as `APP_GUARD`): a session cookie whose epoch is not the user's
 * current one, or whose user no longer exists, is dropped from the request. The route then sees a visitor
 * without a session, so `CurrentUserId` answers 401 and `OptionalUserId` null, as for any other bad cookie.
 *
 * It costs one primary-key read per request that carries a session cookie.
 * ponytail: no cache, so a revocation is felt at once on both replicas; cache it if this read shows in a profile.
 */
@Injectable()
export class SessionEpochGuard implements CanActivate {
  constructor(private readonly permissions: PermissionsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const session = readSession(req);
    if (!session) return true;
    const epoch = await this.permissions.sessionEpoch(session.userId);
    if (epoch !== session.epoch)
      discardSession(req, http.getResponse<FastifyReply>());
    return true;
  }
}

/** 401 without a session, 403 without the permission. Use through `@RequirePermission`, not by name. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const session = readSession(
      ctx.switchToHttp().getRequest<FastifyRequest>(),
    );
    if (!session) throw new UnauthorizedException();
    if (required && !(await this.permissions.has(session.userId, required)))
      throw new ForbiddenException();
    return true;
  }
}

/** The route needs a session whose user holds `permission` through any of their roles. Never check a role name. */
export const RequirePermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(PERMISSION_KEY, permission),
    UseGuards(PermissionGuard),
  );
