import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Name of the signed, httpOnly cookie that carries the logged-in user id. */
export const SESSION_COOKIE = 'uid';

/** ~1 year — keeps the session alive as long as the locally stored display name. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

/** Issues the session cookie after a successful login/signup. */
export function setSession(reply: FastifyReply, userId: number): void {
  reply.setCookie(SESSION_COOKIE, String(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: SESSION_MAX_AGE,
  });
}

/** Clears the session cookie on logout. */
export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Reads and verifies the signed session cookie. Returns null when absent or tampered with. */
function readSessionUserId(req: FastifyRequest): number | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;
  const id = Number(unsigned.value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Injects the authenticated user id, throwing 401 when there is no valid session. */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): number => {
  const id = readSessionUserId(ctx.switchToHttp().getRequest<FastifyRequest>());
  if (id === null) throw new UnauthorizedException();
  return id;
});

/** Injects the authenticated user id, or null when there is no valid session. */
export const OptionalUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): number | null => {
  return readSessionUserId(ctx.switchToHttp().getRequest<FastifyRequest>());
});
