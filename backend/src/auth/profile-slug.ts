/** Pure rules for the vanity part of a public profile link (`/u/<slug>`). No I/O, so it is tested without a database. */

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

/** Lowercase letters and digits, joined by single hyphens: no leading, trailing or doubled hyphen. */
const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Names that would read as the site or its staff, or as an app path. A link is not a route (everything lives
 * under `/u/`), so this is about impersonation, not routing. Small on purpose: grow it when a real case shows up.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'staff', 'support', 'help', 'security', 'system', 'official', 'moderator', 'mod', 'team',
  'api', 'me', 'you', 'user', 'users', 'null', 'undefined', 'anonymous',
  'profile', 'settings', 'login', 'logout', 'leaderboard',
  'university', 'myuniversity', 'my-university', 'kurz',
]);

export type SlugProblem = 'length' | 'format' | 'reserved';

/** What is stored and compared: links are case-insensitive, so the slug is kept in lowercase. */
export const normalizeSlug = (raw: string): string => raw.trim().toLowerCase();

/** Why a normalized slug cannot be used, or null when it can. Availability (taken by someone) is the database's call. */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return 'length';
  if (!SHAPE.test(slug)) return 'format';
  if (RESERVED.has(slug)) return 'reserved';
  return null;
}
