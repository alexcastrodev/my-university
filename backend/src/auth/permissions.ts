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
