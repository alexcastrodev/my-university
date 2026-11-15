/**
 * Every permission there is, as a fixed list in code (#322). A route asks for a permission, never for a role
 * name: roles are only bundles of these, and an admin can make new ones.
 */
export const PERMISSIONS = [
  'admin.access',
  'users.view',
  'roles.manage',
  'ai_credits.grant',
  'ai_credits.reverse',
  'ai.use',
  'discussion.moderate',
  'ai_reports.review',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' &&
  (PERMISSIONS as readonly string[]).includes(value);

/**
 * Nobody hands out, or takes away, what they do not hold themselves: the rule that keeps a person with
 * `roles.manage` from making a role, or giving one, that is worth more than their own.
 */
export const holdsAll = (
  held: readonly string[],
  needed: readonly string[],
): boolean => needed.every((p) => held.includes(p));
