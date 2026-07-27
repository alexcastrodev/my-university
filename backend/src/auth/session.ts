import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Name of the signed, httpOnly cookie that carries the logged-in user id. */
export const SESSION_COOKIE = 'uid';

/** Name of the short-lived signed cookie that carries the GitHub OAuth CSRF state. */
export const OAUTH_STATE_COOKIE = 'gh_oauth_state';

/** ~1 year — keeps the session alive across visits. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

/** Just long enough to complete the GitHub authorize -> callback round trip. */
const OAUTH_STATE_MAX_AGE = 600;

/** Sets a signed, httpOnly cookie. `sameSite: 'lax'` so it still arrives on the GitHub redirect back. */
function setSignedCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  maxAge: number,
): void {
  reply.setCookie(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge,
  });
}

/** Reads and verifies a signed cookie. Returns null when absent or tampered with. */
function readSignedCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.cookies?.[name];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid ? (unsigned.value ?? null) : null;
}

/** Issues the session cookie after a successful GitHub login. */
export function setSession(reply: FastifyReply, userId: number): void {
  setSignedCookie(reply, SESSION_COOKIE, String(userId), SESSION_MAX_AGE);
}

/** Clears the session cookie on logout. */
export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Issues the short-lived CSRF state cookie before redirecting to GitHub. */
export function setOauthState(reply: FastifyReply, state: string): void {
  setSignedCookie(reply, OAUTH_STATE_COOKIE, state, OAUTH_STATE_MAX_AGE);
}

/** Clears the CSRF state cookie once the callback has consumed it. */
export function clearOauthState(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
}

/** Reads and verifies the OAuth state cookie set before redirecting to GitHub. */
export function readOauthState(req: FastifyRequest): string | null {
  return readSignedCookie(req, OAUTH_STATE_COOKIE);
}

/** Reads and verifies the signed session cookie. Returns null when absent or tampered with. */
function readSessionUserId(req: FastifyRequest): number | null {
  const value = readSignedCookie(req, SESSION_COOKIE);
  if (value === null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Injects the authenticated user id, throwing 401 when there is no valid session. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const id = readSessionUserId(
      ctx.switchToHttp().getRequest<FastifyRequest>(),
    );
    if (id === null) throw new UnauthorizedException();
    return id;
  },
);

/** Injects the authenticated user id, or null when there is no valid session. */
export const OptionalUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number | null => {
    return readSessionUserId(ctx.switchToHttp().getRequest<FastifyRequest>());
  },
);
