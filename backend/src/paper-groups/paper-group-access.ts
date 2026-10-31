import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { isUuid } from '../papers/paper-ref';

export const GROUP_ROLES = ['owner', 'moderator', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** Roles a member can be given. There is one owner, made when the group is created, and it does not move. */
export const GIVEN_ROLES = ['moderator', 'member'] as const;

export const bad = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });
export const conflict = (code: string, message: string) => new ConflictException({ statusCode: 409, code, message });
export const forbidden = (message: string) => new ForbiddenException({ statusCode: 403, code: 'not_allowed', message });
export const notFound = (what = 'Group') => new NotFoundException(`${what} not found`);

/** What each role may do. The owner can do everything; a moderator looks after people and the paper list. */
export const canManage = (role: GroupRole) => role === 'owner' || role === 'moderator';

/** Anything the database could not take as an id is the same 404 as a group that does not exist. */
export function groupId(raw: string): string {
  if (!isUuid(raw)) throw notFound();
  return raw;
}

/**
 * The role of a reader in a group, or 404 when they are not in it (and so a group that does not exist and one
 * they may not see are the same answer). Every read and write of a group's content starts here, so leaving a
 * group, or being removed from it, ends access to everything in it at once.
 */
export async function roleIn(db: Pick<EntityManager, 'query'>, userId: number, id: string): Promise<GroupRole> {
  const [row]: { role: GroupRole }[] = await db.query(
    `SELECT role FROM paper_group_member WHERE "groupId" = $1 AND "userId" = $2`,
    [groupId(id), userId],
  );
  if (!row) throw notFound();
  return row.role;
}

/** The same, for a reader who must be able to manage: a member who may not gets 403, they know the group exists. */
export async function managerIn(db: Pick<EntityManager, 'query'>, userId: number, id: string): Promise<GroupRole> {
  const role = await roleIn(db, userId, id);
  if (!canManage(role)) throw forbidden('Only the owner and the moderators can do that');
  return role;
}

/**
 * Takes annotations out of a group: those of one author (leaving, being removed), of one paper (the paper leaves
 * the group), of one share (taken down by its author or a moderator), or all of them (the group is deleted). A
 * share that was only for groups and has none left is deleted, since nobody could see it. The private
 * annotation behind it is never touched. Shares for the public or for named readers are not touched either.
 */
export async function withdrawShares(
  db: Pick<EntityManager, 'query'>,
  where: { groupId: string; authorId?: number; paperSlug?: string; shareId?: string },
): Promise<void> {
  const filters = ['g."groupId" = $1'];
  const params: unknown[] = [where.groupId];
  for (const [column, value] of [
    ['s."authorId"', where.authorId],
    ['s."paperSlug"', where.paperSlug],
    ['s.id', where.shareId],
  ] as const) {
    if (value === undefined) continue;
    params.push(value);
    filters.push(`${column} = $${params.length}`);
  }
  // TypeORM answers a DELETE with `[rows, count]`.
  const [gone]: [{ shareId: string }[], number] = await db.query(
    `DELETE FROM paper_annotation_share_group g USING paper_annotation_share s
      WHERE g."shareId" = s.id AND ${filters.join(' AND ')} RETURNING g."shareId"`,
    params,
  );
  if (!gone.length) return;
  await db.query(
    `DELETE FROM paper_annotation_share s
      WHERE s.id = ANY($1::uuid[]) AND s.visibility = 'group'
        AND NOT EXISTS (SELECT 1 FROM paper_annotation_share_group g WHERE g."shareId" = s.id)`,
    [gone.map((r) => r.shareId)],
  );
}

/**
 * The groups a reader may share an annotation of this paper into: the reader must be in each one, and the paper
 * must be on its list. Anything else, a group of someone else's included, is the same `group_not_found`.
 */
export async function groupsToShareInto(
  db: Pick<EntityManager, 'query'>,
  userId: number,
  slug: string,
  ids: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const [member]: { one: number }[] = isUuid(id)
      ? await db.query(`SELECT 1 AS one FROM paper_group_member WHERE "groupId" = $1 AND "userId" = $2`, [id, userId])
      : [];
    if (!member) throw bad('group_not_found', 'You are not in that reading group');
    const [onList]: { one: number }[] = await db.query(
      `SELECT 1 AS one FROM paper_group_paper WHERE "groupId" = $1 AND "paperSlug" = $2`,
      [id, slug],
    );
    if (!onList) throw bad('paper_not_in_group', 'That paper is not on the group list');
    out.push(id);
  }
  return out;
}
