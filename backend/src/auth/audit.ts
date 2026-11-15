import { EntityManager } from 'typeorm';

/**
 * One row of `admin_audit_event`: who changed what, to whom. Always called in the transaction of the change, so
 * a change and its record stand or fall together. `actorId` is null for a change made from the CLI.
 */
export async function recordAudit(
  m: EntityManager,
  actorId: number | null,
  targetId: number | null,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await m.query(
    `INSERT INTO admin_audit_event ("actorUserId", "targetUserId", action, detail) VALUES ($1, $2, $3, $4)`,
    [actorId, targetId, action, JSON.stringify(detail)],
  );
}
