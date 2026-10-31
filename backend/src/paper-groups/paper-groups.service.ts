import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaperAuditService } from '../paper-audit/paper-audit.service';
import { profileKeyOf } from '../paper-annotations/paper-annotation-share-queries';
import { isUuid } from '../papers/paper-ref';
import { CreateGroupDto, UpdateGroupDto } from './paper-group.dto';
import { GIVEN_ROLES, GroupRole, bad, conflict, forbidden, groupId, managerIn, notFound, roleIn, withdrawShares } from './paper-group-access';

/** How many groups one reader owns, readers in one group (members and pending invitations), and invitations waiting on one reader. */
const maxOwned = () => Number(process.env.PAPER_GROUPS_MAX_OWNED) || 20;
const maxMembers = () => Number(process.env.PAPER_GROUP_MEMBERS_MAX) || 50;
const maxInbox = () => Number(process.env.PAPER_GROUP_INBOX_MAX) || 50;

export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  /** The role of the reader who asked. */
  role: GroupRole;
  memberCount: number;
  paperCount: number;
  createdAt: string;
}

/** A person in a group, by what their public profile publishes. `id` is the id of that profile, for the routes. */
export interface PersonView {
  id: string;
  name: string;
  avatarUrl: string;
  /** `/u/<profile>` only for a profile its owner made public. */
  profile: string | null;
}

export interface MemberView extends PersonView {
  role: GroupRole;
  joinedAt: string;
  you: boolean;
}

export interface InvitationView {
  id: string;
  createdAt: string;
  /** For the invitee's own list. */
  group?: { id: string; name: string; description: string | null };
  invitedBy?: PersonView | null;
  /** For the group's list of pending invitations. */
  invitee?: PersonView;
}

/** One person's public face, from a user row joined as `u`. */
export const PERSON_SQL = `u."publicProfileId" AS "personId",
  COALESCE(NULLIF(trim(u."displayNameOverride"), ''), u."displayName") AS "personName",
  u."avatarUrl" AS "personAvatar",
  CASE WHEN u."profilePublic" THEN COALESCE(u."profileSlug", u."publicProfileId"::text) END AS "personProfile"`;

export const personOf = (r: { personId: string; personName: string; personAvatar: string; personProfile: string | null }): PersonView => ({
  id: r.personId,
  name: r.personName,
  avatarUrl: r.personAvatar,
  profile: r.personProfile,
});

/** Single spaces, nothing at the ends. A blank name, or one with control or invisible characters, is refused. */
function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw bad('name_required', 'A group needs a name');
  if (/\p{C}/u.test(name)) throw bad('name_invalid', 'A group name is plain text');
  return name;
}

/** Plain text up to a few lines: tabs and line breaks are fine, other control characters are not. */
function cleanDescription(raw: string): string | null {
  const text = raw.trim();
  if (/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E]/.test(text)) {
    throw bad('description_invalid', 'A group description is plain text');
  }
  return text || null;
}

/**
 * Reading groups (#190): the people, the roles and the invitations. A group is private: whoever is not in it gets
 * the same 404 as for a group that does not exist, and every method starts from the signed-in reader's own
 * membership (`roleIn`), so leaving or being removed ends access to everything in the group at once. Nothing of
 * a member's library or PDFs is reachable through a group.
 *
 * The owner can do everything and cannot leave (deleting the group is how it ends). A moderator invites and
 * removes plain members, and keeps the paper list, the board and the shared annotations tidy. A member reads,
 * posts, shares their own annotations and leaves.
 */
@Injectable()
export class PaperGroupsService {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PaperAuditService) private readonly audit: PaperAuditService,
  ) {}

  /** The reader's groups; with `paper`, only those that have that public paper on their list (what a share offers). */
  async list(userId: number, paper?: string): Promise<{ items: GroupView[] }> {
    return { items: await this.views(userId, undefined, paper) };
  }

  async create(userId: number, dto: CreateGroupDto): Promise<GroupView> {
    const name = cleanName(dto.name);
    const description = dto.description === undefined ? null : cleanDescription(dto.description);
    const id = await this.dataSource.transaction(async (tx) => {
      // The count and the insert run for one reader at a time, so parallel requests cannot go past the limit.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('paper_group_owner'), $1)`, [userId]);
      const [{ count }]: { count: number }[] = await tx.query(
        `SELECT count(*)::int AS count FROM paper_group WHERE "ownerId" = $1`,
        [userId],
      );
      if (count >= maxOwned()) {
        throw conflict('groups_limit', `You can own up to ${maxOwned()} reading groups. Delete one to start another.`);
      }
      const [{ id: created }]: { id: string }[] = await tx.query(
        `INSERT INTO paper_group ("ownerId", name, description) VALUES ($1, $2, $3) RETURNING id`,
        [userId, name, description],
      );
      await tx.query(`INSERT INTO paper_group_member ("groupId", "userId", role) VALUES ($1, $2, 'owner')`, [created, userId]);
      return created;
    });
    await this.audit.record(userId, 'group.create', null, { group: id });
    return (await this.views(userId, id))[0];
  }

  /** The group, and who is in it. */
  async get(userId: number, id: string): Promise<{ group: GroupView; members: MemberView[] }> {
    await roleIn(this.dataSource, userId, id);
    const members: (Parameters<typeof personOf>[0] & { role: GroupRole; joinedAt: Date; userId: number })[] = await this.dataSource.query(
      `SELECT ${PERSON_SQL}, m.role, m."joinedAt", m."userId"
         FROM paper_group_member m JOIN "user" u ON u.id = m."userId"
        WHERE m."groupId" = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, m."joinedAt", m."userId"`,
      [id],
    );
    return {
      group: (await this.views(userId, id))[0],
      members: members.map((m) => ({ ...personOf(m), role: m.role, joinedAt: m.joinedAt.toISOString(), you: m.userId === userId })),
    };
  }

  /** Only the owner renames a group or changes what it says about itself. */
  async update(userId: number, id: string, dto: UpdateGroupDto): Promise<GroupView> {
    if ((await roleIn(this.dataSource, userId, id)) !== 'owner') throw forbidden('Only the owner can change the group');
    const name = dto.name === undefined ? null : cleanName(dto.name);
    const description = dto.description === undefined ? undefined : cleanDescription(dto.description);
    await this.dataSource.query(
      `UPDATE paper_group
          SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4::varchar ELSE description END, "updatedAt" = now()
        WHERE id = $1`,
      [id, name, description !== undefined, description ?? null],
    );
    return (await this.views(userId, id))[0];
  }

  /** Deletes the group with its members, invitations, paper list, board and shared annotations. No library, paper or PDF of a member is touched. */
  async remove(userId: number, id: string): Promise<void> {
    if ((await roleIn(this.dataSource, userId, id)) !== 'owner') throw forbidden('Only the owner can delete the group');
    await this.dataSource.transaction(async (tx) => {
      await withdrawShares(tx, { groupId: id });
      await tx.query(`DELETE FROM paper_group WHERE id = $1`, [id]);
    });
    await this.audit.record(userId, 'group.delete', null, { group: id });
  }

  /** A member leaves. What they put in the group (posts stay, annotations they shared into it go) is theirs to take back. */
  async leave(userId: number, id: string): Promise<void> {
    if ((await roleIn(this.dataSource, userId, id)) === 'owner') {
      throw conflict('owner_cannot_leave', 'The owner cannot leave the group. Delete it instead.');
    }
    await this.dataSource.transaction(async (tx) => {
      await withdrawShares(tx, { groupId: id, authorId: userId });
      await tx.query(`DELETE FROM paper_group_member WHERE "groupId" = $1 AND "userId" = $2`, [id, userId]);
    });
    await this.audit.record(userId, 'group.leave', null, { group: id });
  }

  /** Takes someone out. The owner can remove anyone else; a moderator only plain members. */
  async removeMember(userId: number, id: string, memberId: string): Promise<void> {
    const role = await managerIn(this.dataSource, userId, id);
    const target = await this.memberByProfile(id, memberId);
    if (target.userId === userId) throw bad('use_leave', 'To go out of the group, leave it');
    if (target.role === 'owner' || (role === 'moderator' && target.role !== 'member')) {
      throw forbidden('A moderator can only remove plain members');
    }
    await this.dataSource.transaction(async (tx) => {
      await withdrawShares(tx, { groupId: id, authorId: target.userId });
      await tx.query(`DELETE FROM paper_group_member WHERE "groupId" = $1 AND "userId" = $2`, [id, target.userId]);
    });
    await this.audit.record(userId, 'group.member_remove', null, { group: id, role: target.role });
  }

  /** Makes a member a moderator, or a plain member again. Only the owner, and never of the owner. */
  async setRole(userId: number, id: string, memberId: string, role: (typeof GIVEN_ROLES)[number]): Promise<MemberView> {
    if ((await roleIn(this.dataSource, userId, id)) !== 'owner') throw forbidden('Only the owner can change roles');
    const target = await this.memberByProfile(id, memberId);
    if (target.role === 'owner') throw bad('owner_role_fixed', 'The owner keeps the owner role');
    await this.dataSource.query(`UPDATE paper_group_member SET role = $3 WHERE "groupId" = $1 AND "userId" = $2`, [id, target.userId, role]);
    await this.audit.record(userId, 'group.role_change', null, { group: id, role });
    const { members } = await this.get(userId, id);
    return members.find((m) => m.id === memberId)!;
  }

  // ---- invitations

  /** Invites a reader by the public profile they give out. A profile that is not public is "not found", like a name nobody has. */
  async invite(userId: number, id: string, rawUser: string): Promise<InvitationView> {
    await managerIn(this.dataSource, userId, id);
    const key = profileKeyOf(rawUser);
    const [invitee]: { id: number }[] = await this.dataSource.query(
      `SELECT id FROM "user" WHERE "profilePublic" AND ${isUuid(key) ? `"publicProfileId" = $1::uuid` : `"profileSlug" = $1`}`,
      [key],
    );
    if (!invitee) throw bad('invitee_not_found', `Nobody has the public profile "${key.slice(0, 60)}"`);
    if (invitee.id === userId) throw bad('invitee_is_you', 'You are already in the group');

    return this.dataSource.transaction(async (tx) => {
      // One at a time per group, so the size limit holds when several invitations arrive together.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('paper_group_invite'), hashtext($1))`, [id]);
      const [already]: { one: number }[] = await tx.query(
        `SELECT 1 AS one FROM paper_group_member WHERE "groupId" = $1 AND "userId" = $2`,
        [id, invitee.id],
      );
      if (already) throw conflict('already_member', 'That reader is already in the group');
      const [pending]: { one: number }[] = await tx.query(
        `SELECT 1 AS one FROM paper_group_invitation WHERE "groupId" = $1 AND "inviteeId" = $2`,
        [id, invitee.id],
      );
      if (pending) throw conflict('already_invited', 'That reader already has an invitation to the group');
      const [{ taken }]: { taken: number }[] = await tx.query(
        `SELECT (SELECT count(*) FROM paper_group_member WHERE "groupId" = $1)::int
              + (SELECT count(*) FROM paper_group_invitation WHERE "groupId" = $1)::int AS taken`,
        [id],
      );
      if (taken >= maxMembers()) throw conflict('group_full', `A group holds up to ${maxMembers()} readers, counting invitations.`);
      const [{ waiting }]: { waiting: number }[] = await tx.query(
        `SELECT count(*)::int AS waiting FROM paper_group_invitation WHERE "inviteeId" = $1`,
        [invitee.id],
      );
      if (waiting >= maxInbox()) throw conflict('invitee_inbox_full', 'That reader has too many invitations waiting');
      const [row]: { id: string; createdAt: Date }[] = await tx.query(
        `INSERT INTO paper_group_invitation ("groupId", "inviteeId", "invitedBy") VALUES ($1, $2, $3) RETURNING id, "createdAt"`,
        [id, invitee.id, userId],
      );
      const [who]: Parameters<typeof personOf>[0][] = await tx.query(`SELECT ${PERSON_SQL} FROM "user" u WHERE u.id = $1`, [invitee.id]);
      return { id: row.id, createdAt: row.createdAt.toISOString(), invitee: personOf(who) };
    });
  }

  /** The invitations waiting on this group, for those who manage it. */
  async invitationsOf(userId: number, id: string): Promise<{ items: InvitationView[] }> {
    await managerIn(this.dataSource, userId, id);
    const rows: (Parameters<typeof personOf>[0] & { id: string; createdAt: Date })[] = await this.dataSource.query(
      `SELECT i.id, i."createdAt", ${PERSON_SQL}
         FROM paper_group_invitation i JOIN "user" u ON u.id = i."inviteeId"
        WHERE i."groupId" = $1 ORDER BY i."createdAt", i.id`,
      [id],
    );
    return { items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), invitee: personOf(r) })) };
  }

  /** Takes an invitation back before it is answered. */
  async revokeInvitation(userId: number, id: string, invitationId: string): Promise<void> {
    await managerIn(this.dataSource, userId, id);
    if (!isUuid(invitationId)) throw notFound('Invitation');
    const [gone]: [unknown[], number] = await this.dataSource.query(
      `DELETE FROM paper_group_invitation WHERE id = $1 AND "groupId" = $2 RETURNING 1`,
      [invitationId, id],
    );
    if (!gone.length) throw notFound('Invitation');
  }

  /** What is waiting on this reader. Nothing about a group is shown beyond its name and description until they accept. */
  async mine(userId: number): Promise<{ items: InvitationView[] }> {
    const rows: (Parameters<typeof personOf>[0] & { id: string; createdAt: Date; groupId: string; groupName: string; description: string | null; invited: boolean })[] =
      await this.dataSource.query(
        `SELECT i.id, i."createdAt", g.id AS "groupId", g.name AS "groupName", g.description, (i."invitedBy" IS NOT NULL) AS invited, ${PERSON_SQL}
           FROM paper_group_invitation i
           JOIN paper_group g ON g.id = i."groupId"
           LEFT JOIN "user" u ON u.id = i."invitedBy"
          WHERE i."inviteeId" = $1 ORDER BY i."createdAt", i.id`,
        [userId],
      );
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        group: { id: r.groupId, name: r.groupName, description: r.description },
        invitedBy: r.invited ? personOf(r) : null,
      })),
    };
  }

  /** Accepting makes the reader a plain member. The invitation is theirs alone: another reader's id is a 404. */
  async accept(userId: number, invitationId: string): Promise<GroupView> {
    const gid = await this.dataSource.transaction(async (tx) => {
      const invitation = await this.invitationOf(tx, userId, invitationId);
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('paper_group_invite'), hashtext($1))`, [invitation.groupId]);
      const [{ members }]: { members: number }[] = await tx.query(
        `SELECT count(*)::int AS members FROM paper_group_member WHERE "groupId" = $1`,
        [invitation.groupId],
      );
      if (members >= maxMembers()) throw conflict('group_full', 'The group is full');
      await tx.query(`DELETE FROM paper_group_invitation WHERE id = $1`, [invitationId]);
      await tx.query(
        `INSERT INTO paper_group_member ("groupId", "userId", role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [invitation.groupId, userId],
      );
      return invitation.groupId;
    });
    await this.audit.record(userId, 'group.join', null, { group: gid });
    return (await this.views(userId, gid))[0];
  }

  async decline(userId: number, invitationId: string): Promise<void> {
    await this.invitationOf(this.dataSource, userId, invitationId);
    await this.dataSource.query(`DELETE FROM paper_group_invitation WHERE id = $1`, [invitationId]);
  }

  // ---- helpers

  private async invitationOf(db: Pick<DataSource, 'query'>, userId: number, invitationId: string): Promise<{ groupId: string }> {
    if (!isUuid(invitationId)) throw notFound('Invitation');
    const [row]: { groupId: string }[] = await db.query(
      `SELECT "groupId" FROM paper_group_invitation WHERE id = $1 AND "inviteeId" = $2`,
      [invitationId, userId],
    );
    if (!row) throw notFound('Invitation');
    return row;
  }

  /** A member of the group by the id of their public profile; not in the group is a 404. */
  private async memberByProfile(id: string, profileId: string): Promise<{ userId: number; role: GroupRole }> {
    if (!isUuid(profileId)) throw notFound('Member');
    const [row]: { userId: number; role: GroupRole }[] = await this.dataSource.query(
      `SELECT m."userId", m.role FROM paper_group_member m JOIN "user" u ON u.id = m."userId"
        WHERE m."groupId" = $1 AND u."publicProfileId" = $2::uuid`,
      [id, profileId],
    );
    if (!row) throw notFound('Member');
    return row;
  }

  /** The groups the reader is in (or one of them), by name. */
  private async views(userId: number, id?: string, paper?: string): Promise<GroupView[]> {
    if (id) groupId(id);
    const rows: { id: string; name: string; description: string | null; role: GroupRole; members: number; papers: number; createdAt: Date }[] =
      await this.dataSource.query(
        `SELECT g.id, g.name, g.description, g."createdAt", m.role,
                (SELECT count(*)::int FROM paper_group_member x WHERE x."groupId" = g.id) AS members,
                (SELECT count(*)::int FROM paper_group_paper p WHERE p."groupId" = g.id) AS papers
           FROM paper_group g JOIN paper_group_member m ON m."groupId" = g.id AND m."userId" = $1
          WHERE ($2::uuid IS NULL OR g.id = $2::uuid)
            AND ($3::varchar IS NULL OR EXISTS (SELECT 1 FROM paper_group_paper p WHERE p."groupId" = g.id AND p."paperSlug" = $3))
          ORDER BY lower(g.name), g.id`,
        [userId, id ?? null, paper ?? null],
      );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      role: r.role,
      memberCount: r.members,
      paperCount: r.papers,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
